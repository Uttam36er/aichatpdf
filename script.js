// Initialize drag and drop functionality
function initializeDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('pdfUpload');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropZone.classList.add('highlight');
    }

    function unhighlight(e) {
        dropZone.classList.remove('highlight');
    }

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('highlight');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('highlight');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('highlight');
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.includes('pdf')) {
            document.getElementById('pdfUpload').files = e.dataTransfer.files;
            handleFileSelect({ target: { files: [file] } });
        } else {
            showNotification('Please upload a PDF file', 'error');
        }
    });

    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        fileInput.files = files;
        if (files[0].type === 'application/pdf') {
            handleFileSelect({ target: fileInput });
        } else {
            showNotification('Please upload a PDF file', 'error');
        }
    }
}

// Handle file selection
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.includes('pdf')) {
        showNotification('Please upload a PDF file', 'error');
        return;
    }

    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.querySelector('.file-name');
    fileName.textContent = file.name;
    fileInfo.style.display = 'flex';

    uploadFile(file);
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const progressBar = document.getElementById('uploadProgress');
    const progressFill = progressBar.querySelector('.progress-fill');
    const progressText = progressBar.querySelector('.progress-text');
    const questionSection = document.getElementById('questionSection');
    
    progressBar.style.display = 'block';
    questionSection.style.display = 'none'; // Hide question section during upload
    updateProgress(10, 'Starting upload...');

    try {
        // Upload file
        const uploadResponse = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        updateProgress(30, 'File uploaded, processing started...');
        
        // Start checking processing status
        await checkProcessingStatus();
        
        // Show question section after successful processing
        questionSection.style.display = 'block';
        document.getElementById('question').focus();

    } catch (error) {
        console.error('Upload error:', error);
        showNotification(`Upload failed: ${error.message}`, 'error');
        resetUploadState();
    }
}

function updateProgress(percent, message) {
    const progressBar = document.getElementById('uploadProgress');
    const progressFill = progressBar.querySelector('.progress-fill');
    const progressText = progressBar.querySelector('.progress-text');
    
    progressFill.style.width = `${percent}%`;
    progressText.textContent = message;
}

function resetUploadState() {
    const fileInput = document.getElementById('pdfUpload');
    const fileInfo = document.getElementById('fileInfo');
    const progressBar = document.getElementById('uploadProgress');
    const questionSection = document.getElementById('questionSection');
    
    fileInput.value = '';
    fileInfo.style.display = 'none';
    progressBar.style.display = 'none';
    questionSection.style.display = 'none';
}

function removeFile() {
    resetUploadState();
}

// Show file information
function showFileInfo(file) {
    const fileInfo = document.getElementById('fileInfo');
    const fileName = fileInfo.querySelector('.file-name');
    const dropZone = document.getElementById('dropZone');
    
    fileName.textContent = file.name;
    fileInfo.style.display = 'flex';
    dropZone.style.display = 'none';
}

// Upload PDF file
async function uploadPDF(file) {
    const progressBar = document.getElementById('uploadProgress');
    const progressFill = progressBar.querySelector('.progress-fill');
    const progressText = progressBar.querySelector('.progress-text');
    
    try {
        progressBar.style.display = 'block';
        updateProgress(0, 'Starting upload...');

        const formData = new FormData();
        formData.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                updateProgress(percent, 'Uploading...');
            }
        };

        xhr.onload = async function() {
            try {
                const data = JSON.parse(xhr.responseText);
                if (xhr.status === 200) {
                    updateProgress(100, 'Processing PDF content...');
                    showNotification('PDF uploaded successfully! Processing content...', 'info');
                    checkProcessingStatus();
                } else {
                    throw new Error(data.message || 'Upload failed');
                }
            } catch (error) {
                console.error('Error handling upload response:', error);
                showNotification(error.message || 'Error processing server response', 'error');
                updateProgress(0, 'Upload failed');
                resetUploadState();
            }
        };

        xhr.onerror = function() {
            showNotification('Network error during upload', 'error');
            updateProgress(0, 'Upload failed');
            resetUploadState();
        };

        xhr.send(formData);

    } catch (error) {
        console.error("Error uploading PDF:", error);
        showNotification('Error uploading PDF', 'error');
        resetUploadState();
    }
}

// Function to check processing status
async function checkProcessingStatus() {
    const progressBar = document.getElementById('uploadProgress');
    const maxAttempts = 120; // 10 minutes maximum (120 * 5 seconds)
    let attempts = 0;

    const checkStatus = async () => {
        try {
            const response = await fetch('/status');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data || typeof data.status === 'undefined') {
                throw new Error('Invalid response format from server');
            }

            // Update progress message with more detail
            let progressMessage = data.progress || 'Processing...';
            if (data.current_file) {
                progressMessage += ` (${data.current_file})`;
            }

            switch (data.status) {
                case 'completed':
                    updateProgress(100, 'Processing completed');
                    showNotification('PDF processed successfully!', 'success');
                    document.getElementById("questionSection").style.display = "block";
                    document.getElementById("question").focus();
                    setTimeout(() => {
                        progressBar.style.display = 'none';
                    }, 2000);
                    break;

                case 'failed':
                    const errorMsg = data.error || 'Processing failed';
                    showNotification(`Error: ${errorMsg}`, 'error');
                    updateProgress(0, 'Processing failed');
                    progressBar.style.display = 'none';
                    break;

                case 'processing':
                    updateProgress(100, progressMessage);
                    attempts++;

                    if (attempts >= maxAttempts) {
                        showNotification(
                            'Processing is taking longer than expected. The file might be too large or complex. You can try with a smaller file.',
                            'warning'
                        );
                        progressBar.style.display = 'none';
                        return;
                    }

                    // Check again in 5 seconds
                    setTimeout(() => checkStatus(), 5000);
                    break;

                case 'uploading':
                    updateProgress(50, progressMessage);
                    setTimeout(() => checkStatus(), 1000); // Check more frequently during upload
                    break;

                default:
                    updateProgress(100, 'Processing PDF...');
                    attempts++;
                    
                    if (attempts >= maxAttempts) {
                        showNotification(
                            'Processing timeout. The file might be too large or complex. You can try with a smaller file.',
                            'warning'
                        );
                        progressBar.style.display = 'none';
                        return;
                    }
                    
                    setTimeout(() => checkStatus(), 5000);
            }
        } catch (error) {
            console.error('Error checking status:', error);
            attempts++;
            
            // Show error after 3 failed attempts
            if (attempts >= 3) {
                showNotification(
                    'Error checking processing status. The server might be overloaded. Please try again later.',
                    'error'
                );
                progressBar.style.display = 'none';
            } else {
                // Try again in 5 seconds
                setTimeout(() => checkStatus(), 5000);
            }
        }
    };

    // Start checking status
    await checkStatus();
}

// Handle Enter key in question input
function handleEnter(event) {
    if (event.key === 'Enter') {
        askQuestion();
    }
}

// Ask a question
async function askQuestion() {
    const questionInput = document.getElementById('question');
    const question = questionInput.value.trim();
    const answerSection = document.getElementById('answerSection');
    const answerContent = answerSection.querySelector('.answer-content');

    if (!question) {
        showNotification('Please enter a question', 'warning');
        return;
    }

    try {
        answerSection.style.display = 'block';
        answerContent.innerHTML = '<div class="loading"></div>';

        const response = await fetch('/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ question: question }),
        });

        const data = await response.json();
        
        if (response.ok) {
            answerContent.textContent = data.answer;
            questionInput.value = '';
        } else {
            throw new Error(data.message || 'Failed to get answer');
        }
    } catch (error) {
        console.error('Error asking question:', error);
        showNotification(error.message || 'Error getting answer', 'error');
        answerContent.textContent = 'Failed to get answer. Please try again.';
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icon = document.createElement('i');
    switch (type) {
        case 'success':
            icon.className = 'fas fa-check-circle';
            break;
        case 'error':
            icon.className = 'fas fa-exclamation-circle';
            break;
        case 'warning':
            icon.className = 'fas fa-exclamation-triangle';
            break;
        default:
            icon.className = 'fas fa-info-circle';
    }
    
    const text = document.createElement('span');
    text.textContent = message;
    
    notification.appendChild(icon);
    notification.appendChild(text);
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Font size control functionality
let currentFontSize = 16;
const minFontSize = 12;
const maxFontSize = 24;

function changeFontSize(action) {
    const responseDiv = document.getElementById('response');
    
    switch(action) {
        case 'increase':
            if (currentFontSize < maxFontSize) {
                currentFontSize += 2;
            }
            break;
        case 'decrease':
            if (currentFontSize > minFontSize) {
                currentFontSize -= 2;
            }
            break;
        case 'reset':
            currentFontSize = 16;
            break;
    }
    
    responseDiv.style.fontSize = `${currentFontSize}px`;
}

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    initializeDragAndDrop();
});
