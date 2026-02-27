// config/cron-tasks.js

/**
 * Helper to calculate elapsed seconds from the JSON timeLogs array.
 */
function calculateElapsedSeconds(timeLogs, actualStartAt, status) {
  if (!timeLogs || timeLogs.length === 0) {
      if (!actualStartAt || status === 'paused') return 0;
      return Math.floor((new Date().getTime() - new Date(actualStartAt).getTime()) / 1000);
  }

  let totalActiveMs = 0;
  let currentStartMs = null;

  timeLogs.forEach((log) => {
      const time = new Date(log.timestamp).getTime();
      if (log.status === 'start' || log.status === 'resume') {
          currentStartMs = time;
      } else if (log.status === 'pause' && currentStartMs !== null) {
          totalActiveMs += (time - currentStartMs);
          currentStartMs = null; 
      }
  });

  if (currentStartMs !== null && status === 'in_progress') {
      totalActiveMs += (new Date().getTime() - currentStartMs);
  }

  return Math.max(0, Math.floor(totalActiveMs / 1000));
}


module.exports = {
  // This runs every 1 minute
  '*/1 * * * *': async ({ strapi }) => {
    try {
      const now = new Date();

      // 1. Fetch sessions that are 'in_progress'
      // We IGNORE 'paused' sessions. They will not be auto-completed until resumed.
      const activeSessions = await strapi.db.query('api::activity-session.activity-session').findMany({
        where: {
          activitySessionStatus: 'in_progress',
          actualStartAt: { $notNull: true },
          actualEndAt: { $null: true },
        },
        populate: {
          activity: true
        },
      });

      for (const session of activeSessions) {
        const startTime = new Date(session.actualStartAt);
        const durationMinutes = session.activity?.durationMinutes;

        // Cleanup stale untimered activities
        if (!durationMinutes || durationMinutes <= 0) {
          const fourHoursAgo = new Date(now.getTime() - (4 * 60 * 60 * 1000));
          if (startTime < fourHoursAgo) {
            await strapi.db.query('api::activity-session.activity-session').update({
              where: { id: session.id },
              data: {
                activitySessionStatus: 'abandoned',
                actualEndAt: now.toISOString(),
              },
            });
            strapi.log.info(`CRON: Closed stale media session ID ${session.id}`);
          }
          continue; 
        }

        // 2. Use the new helper to get exact time played
        const elapsedSeconds = calculateElapsedSeconds(
            session.timeLogs, 
            session.actualStartAt, 
            session.activitySessionStatus
        );

        const durationSeconds = durationMinutes * 60;
        const gracePeriodSeconds = 60; // 1-minute buffer

        // 3. Force-close if the exact accumulated time exceeds the duration limit
        if (elapsedSeconds >= (durationSeconds + gracePeriodSeconds)) {
          await strapi.db.query('api::activity-session.activity-session').update({
            where: { id: session.id },
            data: {
              activitySessionStatus: 'completed',
              actualEndAt: now.toISOString(), 
            },
          });
          
          strapi.log.info(`CRON: Auto-completed timed session ID ${session.id} (Learner: ${session.student?.firstName})`);
        }
      }
    } catch (error) {
      strapi.log.error('CRON ERROR: Failed to check active sessions', error);
    }
  },
};