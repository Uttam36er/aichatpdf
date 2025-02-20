import os
import warnings
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_community.document_loaders import PyPDFLoader
from langchain_community.vectorstores import Chroma
from langchain_core.documents import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chains.retrieval_qa.base import RetrievalQA
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# Load environment variables
load_dotenv()
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = "uploads"
VECTOR_FOLDER = "vector_store"  # Folder to save vector store
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(VECTOR_FOLDER, exist_ok=True)

vector_store = None
processing_status = {
    "status": "idle",
    "progress": "",
    "error": None,
    "current_file": None
}

def update_processing_status(status, progress="", error=None):
    """Update the global processing status."""
    global processing_status
    processing_status = {
        "status": status,
        "progress": progress,
        "error": error,
        "current_file": processing_status["current_file"]
    }

def process_document_chunk(chunk, embeddings):
    """Process a chunk of documents in parallel."""
    try:
        return embeddings.embed_documents(chunk)
    except Exception as e:
        print(f"Error processing chunk: {e}")
        return None

def process_pdf_async(file_path):
    """Process PDF asynchronously with status updates and optimizations."""
    global vector_store
    try:
        update_processing_status("processing", "Loading PDF file...")
        loader = PyPDFLoader(file_path)
        documents = loader.load()

        update_processing_status("processing", "Splitting document into chunks...")
        # Increased chunk size and reduced overlap for faster processing
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,  # Larger chunks
            chunk_overlap=20,  # Minimal overlap
            separators=["\n\n", "\n", ".", "!", "?", ",", " ", ""],
            length_function=len
        )
        split_docs = text_splitter.split_documents(documents)

        update_processing_status("processing", "Creating embeddings...")
        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/embedding-001",
            task_type="retrieval_query",
            candidate_count=1  # Reduce candidate count for faster processing
        )

        # Process larger chunks in parallel
        chunk_size = 20  # Increased chunk size
        doc_chunks = [split_docs[i:i + chunk_size] for i in range(0, len(split_docs), chunk_size)]
        
        all_embeddings = []
        with ThreadPoolExecutor(max_workers=8) as executor:  # Increased worker count
            futures = []
            for chunk in doc_chunks:
                future = executor.submit(process_document_chunk, [doc.page_content for doc in chunk], embeddings)
                futures.append(future)
            
            total_chunks = len(doc_chunks)
            for i, future in enumerate(as_completed(futures), 1):
                chunk_embeddings = future.result()
                if chunk_embeddings:
                    all_embeddings.extend(chunk_embeddings)
                update_processing_status("processing", f"Processing embeddings... {i}/{total_chunks} chunks complete")

        update_processing_status("processing", "Creating vector store...")
        # Use in-memory Chroma for faster processing
        vector_store = Chroma.from_documents(
            split_docs, 
            embeddings,
            collection_metadata={
                "hnsw:space": "cosine",
                "hnsw:construction_ef": 80,  # Reduced for faster indexing
                "hnsw:M": 8,  # Reduced for faster indexing
            }
        )
        
        update_processing_status("completed", "PDF processed successfully")
    except Exception as e:
        print(f"Error processing PDF: {e}")
        update_processing_status("failed", error=str(e))

def get_qa_chain():
    """Creates a Q&A retrieval chain with Google Gemini."""
    if vector_store is None:
        return None
    
    llm = ChatGoogleGenerativeAI(
        model="gemini-1.5-pro-latest",
        temperature=0.1,
        convert_system_message_to_human=True,
        model_kwargs={
            "max_output_tokens": 8192,
            "top_k": 20,  # Reduced for faster processing
            "top_p": 0.95,
            "temperature": 0.1
        }
    )
    
    # Optimize retriever settings for speed
    retriever = vector_store.as_retriever(
        search_type="similarity",  # Changed to simple similarity search
        search_kwargs={
            "k": 2,  # Reduced for faster retrieval
        }
    )
    
    return RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=retriever,
        return_source_documents=True
    )

@app.route("/upload", methods=["POST"])
def upload_pdf():
    """Handles PDF upload and starts processing."""
    if "file" not in request.files:
        return jsonify({"message": "No file part"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"message": "No selected file"}), 400

    global processing_status
    processing_status = {
        "status": "uploading",
        "progress": "Starting upload...",
        "error": None,
        "current_file": file.filename
    }

    try:
        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(file_path)
        
        processing_thread = threading.Thread(target=process_pdf_async, args=(file_path,))
        processing_thread.start()
        
        return jsonify({
            "message": "File uploaded, processing started",
            "status": "processing"
        })
    except Exception as e:
        update_processing_status("failed", error=str(e))
        return jsonify({"message": f"Error uploading file: {str(e)}"}), 500

@app.route("/status", methods=["GET"])
def get_status():
    """Returns the current processing status."""
    return jsonify(processing_status)

@app.route("/query", methods=["POST"])
def ask_question():
    """Handles user questions and returns answers."""
    if processing_status["status"] != "completed":
        return jsonify({"message": "PDF is still being processed"}), 400

    data = request.json
    question = data.get("question")

    qa_chain = get_qa_chain()
    if qa_chain is None:
        return jsonify({"answer": "No PDF has been uploaded or processed yet."}), 400

    try:
        response = qa_chain.invoke({"query": question})
        return jsonify({"answer": response.get("result", "No answer found.")})
    except Exception as e:
        return jsonify({"message": f"Error processing question: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(debug=True)
