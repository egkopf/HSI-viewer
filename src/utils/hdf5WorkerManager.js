// HDF5 Worker Manager for coordinating lazy file parsing
// Implements the myhdf5.hdfgroup.org approach using web workers + WORKERFS

class HDF5WorkerManager {
  constructor() {
    this.worker = null;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.isInitialized = false;
  }

  // Initialize the worker
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create worker from the worker file
      this.worker = new Worker(new URL('../workers/hdf5Worker.js', import.meta.url));
      
      // Set up message handling
      this.worker.onmessage = (e) => {
        this.handleWorkerMessage(e.data);
      };
      
      this.worker.onerror = (error) => {
        console.error('HDF5 Worker error:', error);
        this.rejectAllPending(new Error('Worker error occurred'));
      };
      
      this.isInitialized = true;
      console.log('HDF5 Worker Manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize HDF5 Worker Manager:', error);
      throw new Error('Could not initialize HDF5 worker support');
    }
  }

  // Handle messages from worker
  handleWorkerMessage(message) {
    const { type, fileId, success, metadata, error } = message;
    
    const pendingRequest = this.pendingRequests.get(fileId);
    if (!pendingRequest) {
      console.warn('Received message for unknown request:', fileId);
      return;
    }

    switch (type) {
      case 'STRUCTURE_PARSED':
        if (success) {
          console.log('Structure parsing completed for:', fileId);
          pendingRequest.resolve(metadata);
        } else {
          console.error('Structure parsing failed for:', fileId, error);
          pendingRequest.reject(new Error(error || 'Structure parsing failed'));
        }
        this.pendingRequests.delete(fileId);
        break;

      case 'CLEANUP_COMPLETE':
        if (pendingRequest.cleanup) {
          if (success) {
            pendingRequest.cleanup.resolve();
          } else {
            pendingRequest.cleanup.reject(new Error(error || 'Cleanup failed'));
          }
        }
        this.pendingRequests.delete(fileId);
        break;

      case 'ERROR':
        console.error('Worker reported error for:', fileId, error);
        pendingRequest.reject(new Error(error || 'Worker operation failed'));
        this.pendingRequests.delete(fileId);
        break;

      default:
        console.warn('Unknown message type from worker:', type);
    }
  }

  // Parse HDF5 structure using worker
  async parseHDF5Structure(file) {
    await this.initialize();

    const fileId = `file_${this.requestId++}_${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      // Store pending request
      this.pendingRequests.set(fileId, { resolve, reject });

      // Send parsing request to worker
      this.worker.postMessage({
        type: 'PARSE_STRUCTURE',
        fileId,
        file
      });

      // Set timeout for the request (increased for large files)
      setTimeout(() => {
        if (this.pendingRequests.has(fileId)) {
          this.pendingRequests.delete(fileId);
          reject(new Error('HDF5 parsing timeout - file may be too large or corrupted'));
        }
      }, 60000); // 60 second timeout for large files
    });
  }

  // Clean up file resources
  async cleanupFile(fileId) {
    if (!this.isInitialized || !this.worker) {
      return;
    }

    return new Promise((resolve, reject) => {
      // Store cleanup request
      if (this.pendingRequests.has(fileId)) {
        this.pendingRequests.get(fileId).cleanup = { resolve, reject };
      } else {
        this.pendingRequests.set(fileId, { cleanup: { resolve, reject } });
      }

      // Send cleanup request to worker
      this.worker.postMessage({
        type: 'CLEANUP',
        fileId
      });

      // Set timeout for cleanup
      setTimeout(() => {
        if (this.pendingRequests.has(fileId)) {
          this.pendingRequests.delete(fileId);
          resolve(); // Don't fail on cleanup timeout
        }
      }, 5000); // 5 second timeout for cleanup
    });
  }

  // Reject all pending requests (used for error handling)
  rejectAllPending(error) {
    for (const [fileId, request] of this.pendingRequests) {
      request.reject(error);
    }
    this.pendingRequests.clear();
  }

  // Terminate worker and clean up
  async terminate() {
    if (this.worker) {
      this.rejectAllPending(new Error('Worker manager terminated'));
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      console.log('HDF5 Worker Manager terminated');
    }
  }
}

// Create singleton instance
const hdf5WorkerManager = new HDF5WorkerManager();

export default hdf5WorkerManager;