const { ApplicationError } = require('@strapi/utils').errors;
const crypto = require('crypto');

module.exports = {
  // 1. Generate the Friendly ID the moment it gets added to the calendar
  async beforeCreate(event) {
    const { data } = event.params;
    if (!data.sessionId) {
      data.sessionId = `ACT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    // Check if the session is specifically being started
    if (data.activitySessionStatus === 'in_progress') {
      
      // Fallback: Generate ID if it somehow missed the beforeCreate hook
      if (!data.sessionId) {
        data.sessionId = `ACT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      }

      // 2. THE INTERLOCK: Fetch the current session to identify the student
      const currentSession = await strapi.db.query('api::activity-session.activity-session').findOne({
        where: { id: where.id },
        populate: ['student'],
      });

      // Ensure the student exists before checking for conflicts
      if (currentSession?.student?.id) {
        const runningSession = await strapi.db.query('api::activity-session.activity-session').findOne({
          where: {
            student: currentSession.student.id,
            activitySessionStatus: 'in_progress',
            // Ensure we aren't comparing the session against itself
            id: { $ne: currentSession.id } 
          },
          select: ['id'] // OPTIMIZATION: We only need the ID, don't query the whole massive object
        });

        // 3. ENFORCE THE LOCK
        if (runningSession) {
          throw new ApplicationError(
            'Operation Rejected: This learner already has an active session running on the server.'
          );
        }
      }
    }
  },
};