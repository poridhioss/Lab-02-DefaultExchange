/**
 * Task type definitions with processing logic
 * Each task type has a name, processor function, and estimated duration
 */

const taskTypes = {
  EMAIL: {
    name: 'EMAIL',
    description: 'Send email notification',
    // Simulate email sending with random delay
    process: async (data) => {
      const delay = Math.random() * 2000 + 1000; // 1-3 seconds
      await sleep(delay);
      return {
        status: 'sent',
        recipient: data.recipient,
        subject: data.subject,
        sentAt: new Date().toISOString(),
      };
    },
  },

  IMAGE_PROCESSING: {
    name: 'IMAGE_PROCESSING',
    description: 'Process and resize images',
    // Simulate image processing with longer delay
    process: async (data) => {
      const delay = Math.random() * 5000 + 3000; // 3-8 seconds
      await sleep(delay);
      return {
        status: 'processed',
        imageUrl: data.imageUrl,
        dimensions: data.dimensions || '800x600',
        processedAt: new Date().toISOString(),
      };
    },
  },

  REPORT_GENERATION: {
    name: 'REPORT_GENERATION',
    description: 'Generate PDF reports',
    // Simulate report generation with variable delay
    process: async (data) => {
      const delay = Math.random() * 4000 + 2000; // 2-6 seconds
      await sleep(delay);
      return {
        status: 'generated',
        reportType: data.reportType,
        recordCount: data.recordCount || 0,
        generatedAt: new Date().toISOString(),
      };
    },
  },

  DATA_BACKUP: {
    name: 'DATA_BACKUP',
    description: 'Backup database',
    // Simulate backup with longer processing time
    process: async (data) => {
      const delay = Math.random() * 6000 + 4000; // 4-10 seconds
      await sleep(delay);
      return {
        status: 'completed',
        database: data.database,
        size: data.size || 'unknown',
        backupLocation: `/backups/${Date.now()}.sql`,
        completedAt: new Date().toISOString(),
      };
    },
  },
};

// Helper function to simulate async work
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get task processor by type
 * @param {string} taskType - The type of task to process
 * @returns {Object} Task definition or null
 */
function getTaskProcessor(taskType) {
  return taskTypes[taskType] || null;
}

/**
 * Get list of all available task types
 * @returns {Array} Array of task type names
 */
function getAvailableTaskTypes() {
  return Object.keys(taskTypes);
}

module.exports = {
  taskTypes,
  getTaskProcessor,
  getAvailableTaskTypes,
};
