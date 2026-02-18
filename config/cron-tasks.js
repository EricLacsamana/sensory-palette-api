// config/cron-tasks.js

module.exports = {
  // This syntax means "Run every 1 minute"
  '*/1 * * * *': async ({ strapi }) => {
    try {
      const now = new Date();

      // 1. Fetch sessions that are currently 'in_progress' and actually started
      const activeSessions = await strapi.db.query('api::activity-session.activity-session').findMany({
        where: {
          activitySessionStatus: 'in_progress',
          actualStartAt: { $notNull: true },
        },
        populate: ['activity'],
      });

      // 2. Loop through them to check for expired time
      for (const session of activeSessions) {
        if (!session.actualStartAt) continue;

        const startTime = new Date(session.actualStartAt);
        const durationMinutes = session.activity?.durationMinutes; 
        
        // Calculate the exact time this session SHOULD have ended
        const expectedEndTime = new Date(startTime.getTime() + durationMinutes * 60000);

        // 3. Force-close the session if it's past the expected end time
        if (now >= expectedEndTime) {
          await strapi.db.query('api::activity-session.activity-session').update({
            where: { id: session.id },
            data: {
              activitySessionStatus: 'completed',
              actualEndAt: expectedEndTime.toISOString(), 
            },
          });
          
          strapi.log.info(`CRON: Auto-completed stuck session ID ${session.id}`);
        }
      }
    } catch (error) {
      strapi.log.error('CRON ERROR: Failed to check active sessions', error);
    }
  },
};