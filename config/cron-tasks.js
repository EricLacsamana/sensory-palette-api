'use strict';

/**
 * Helper to calculate elapsed seconds using Gross minus Paused
 */
function calculateElapsedSeconds(timeLogs, actualStartAt, status) {
  if (!actualStartAt) return 0;
  
  const startMs = new Date(actualStartAt).getTime();
  const nowMs = new Date().getTime();
  const grossMs = nowMs - startMs;

  if (!timeLogs || timeLogs.length === 0) {
      if (status === 'paused') return 0;
      return Math.floor(grossMs / 1000);
  }

  let totalPausedMs = 0;
  let lastPauseMs = null;

  const sortedLogs = [...timeLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  sortedLogs.forEach((log) => {
      const time = new Date(log.timestamp).getTime();
      if (log.status === 'pause') {
          lastPauseMs = time;
      } else if ((log.status === 'resume' || log.status === 'start') && lastPauseMs !== null) {
          totalPausedMs += (time - lastPauseMs);
          lastPauseMs = null; 
      }
  });

  if (lastPauseMs !== null) {
      totalPausedMs += (nowMs - lastPauseMs);
  }

  return Math.max(0, Math.floor((grossMs - totalPausedMs) / 1000));
}

module.exports = {
  // This runs every 1 minute
  '*/1 * * * *': async ({ strapi }) => {
    try {
      const now = new Date();

      // ====================================================================
      // TASK 1: AUTO-COMPLETE EXPIRED SESSIONS 
      // ====================================================================
      const activeSessions = await strapi.documents('api::activity-session.activity-session').findMany({
        filters: {
          activitySessionStatus: 'in_progress',
          actualStartAt: { $notNull: true },
          actualEndAt: { $null: true },
        },
        populate: ['activity', 'student', 'therapist'],
      });

      for (const session of activeSessions) {
        const startTime = new Date(session.actualStartAt);
        const durationMinutes = session.activity?.durationMinutes;
        const therapistDocId = session.therapist?.documentId;
        const studentName = session.student?.firstName || 'The learner';

        // Cleanup stale untimered activities (4 hours max)
        if (!durationMinutes || durationMinutes <= 0) {
          const fourHoursAgo = new Date(now.getTime() - (4 * 60 * 60 * 1000));
          
          if (startTime < fourHoursAgo) {
            await strapi.documents('api::activity-session.activity-session').update({
              documentId: session.documentId,
              data: {
                activitySessionStatus: 'abandoned',
                actualEndAt: now.toISOString(),
              },
            });

            if (therapistDocId) {
              await strapi.documents('api::notification.notification').create({
                data: {
                  title: 'Session Auto-Closed ⚠️',
                  message: `${studentName}'s session for ${session.activity?.name} was open for over 4 hours and has been marked as abandoned.`,
                  type: 'lifecycle',
                  priority: 'warning',
                  user: therapistDocId,
                  activitySession: session.documentId,
                  publishedAt: new Date(),
                }
              });
            }
            strapi.log.info(`CRON: Closed stale media session DocID ${session.documentId}`);
          }
          continue; 
        }

        // Use the helper to get exact net time played
        const elapsedSeconds = calculateElapsedSeconds(
            session.timeLogs, 
            session.actualStartAt, 
            session.activitySessionStatus
        );

        const extraTimeSeconds = session.extraTimeSeconds || 0;
        const durationSeconds = (durationMinutes * 60) + extraTimeSeconds;
        const gracePeriodSeconds = 60; // 1-minute buffer

        if (elapsedSeconds >= (durationSeconds + gracePeriodSeconds)) {
          await strapi.documents('api::activity-session.activity-session').update({
            documentId: session.documentId,
            data: {
              activitySessionStatus: 'completed',
              actualEndAt: now.toISOString(), 
            },
          });
          
          if (therapistDocId) {
            await strapi.documents('api::notification.notification').create({
              data: {
                title: 'Time Limit Reached ⏱️',
                message: `${studentName} has reached the time limit for ${session.activity?.name}. The session was auto-completed.`,
                type: 'schedule',
                priority: 'info',
                user: therapistDocId,
                activitySession: session.documentId,
                publishedAt: new Date(),
              }
            });
          }
          strapi.log.info(`CRON: Auto-completed timed session DocID ${session.documentId}`);
        }
      }

      // ====================================================================
      // TASK 2: UPCOMING SESSION NOTIFICATIONS
      // ====================================================================
      const upcomingThreshold = new Date(now.getTime() + 10 * 60000); 

      const upcomingSessions = await strapi.documents('api::activity-session.activity-session').findMany({
        filters: {
          activitySessionStatus: { $in: ['pending', 'queued'] },
          startAt: {
            $gt: now.toISOString(),
            $lte: upcomingThreshold.toISOString(),
          }
        },
        populate: ['student', 'therapist', 'activity'],
      });

      for (const session of upcomingSessions) {
        const existingNotifs = await strapi.documents('api::notification.notification').findMany({
          filters: {
            activitySession: { documentId: { $eq: session.documentId } },
            title: { $contains: 'Upcoming' }
          }
        });

        if (existingNotifs.length === 0) {
          const studentId = session.student?.documentId;
          const therapistId = session.therapist?.documentId;
          const activityName = session.activity?.name || 'an activity';
          const studentName = session.student?.firstName || 'Your student';

          if (therapistId) {
            await strapi.documents('api::notification.notification').create({
              data: {
                title: 'Upcoming Session ⏰',
                message: `${studentName} is scheduled to start ${activityName} in less than 10 minutes.`,
                type: 'schedule',
                priority: 'info',
                user: therapistId,
                activitySession: session.documentId,
                publishedAt: new Date(),
              }
            });
          }

          if (studentId) {
            await strapi.documents('api::notification.notification').create({
              data: {
                title: 'Upcoming Session ⏰',
                message: `Your session for ${activityName} is starting soon! Ensure your device is ready.`,
                type: 'schedule',
                priority: 'info',
                user: studentId,
                activitySession: session.documentId,
                publishedAt: new Date(),
              }
            });
          }
        }
      }

      // ====================================================================
      // TASK 3: SMART PASSCODE CLEANUP
      // ====================================================================
      const expiredUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: {
          passcodeExpiresAt: { $lt: now.toISOString() },
          activePasscode: { $notNull: true },
        }
      });

      for (const user of expiredUsers) {
        // Check if student still has active/queued sessions
        const activeCount = await strapi.db.query('api::activity-session.activity-session').count({
          where: {
            student: user.id,
            activitySessionStatus: { $in: ['in_progress', 'queued'] }
          }
        });

        if (activeCount > 0) {
          // ✨ Do not expire! Extend the passcode by 1 hour because they are still active
          const extendedExpiry = new Date(now.getTime() + (60 * 60 * 1000));
          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: user.id },
            data: { passcodeExpiresAt: extendedExpiry }
          });
          strapi.log.info(`CRON: Extended active PIN for student ID ${user.id} (Sessions remaining: ${activeCount})`);
        } else {
          // ✨ Pipeline is fully empty, safe to expire
          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: user.id },
            data: { activePasscode: null, passcodeExpiresAt: null }
          });
          strapi.log.info(`CRON: Cleared expired PIN for student ID ${user.id}`);
        }
      }

    } catch (error) {
      strapi.log.error('CRON ERROR:', error);
    }
  },
};