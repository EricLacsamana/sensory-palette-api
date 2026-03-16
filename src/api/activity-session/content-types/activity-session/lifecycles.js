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

  // 2. Interlock & State Capture
  async beforeUpdate(event) {
    const { data, where } = event.params;

    // THE INTERLOCK & NOTIFICATION STATE: Fetch the current database state for this session
    const currentSession = await strapi.db.query('api::activity-session.activity-session').findOne({
      where: { id: where.id },
      populate: ['student', 'therapist', 'activity'], 
    });

    // Pass the old data to the afterUpdate hook to compare state changes
    event.state.oldData = currentSession;

    // Check if the session is specifically being set to in_progress
    if (data.activitySessionStatus === 'in_progress') {
      
      // BYPASS: If the session is ALREADY 'in_progress', allow the update to proceed.
      if (currentSession?.activitySessionStatus === 'in_progress') {
        return; 
      }

      // Fallback: Generate ID if it somehow missed the beforeCreate hook
      if (!data.sessionId && !currentSession?.sessionId) {
        data.sessionId = `ACT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      }

      // Ensure the student exists before checking for conflicts
      if (currentSession?.student?.id) {
        const runningSession = await strapi.db.query('api::activity-session.activity-session').findOne({
          where: {
            student: currentSession.student.id,
            activitySessionStatus: 'in_progress',
            id: { $ne: where.id } // Redundant but safe check
          },
          select: ['id']
        });

        // ENFORCE THE LOCK: Block only if another session is already running
        if (runningSession) {
          throw new ApplicationError(
            'Operation Rejected: This learner already has an active session running on the server.'
          );
        }
      }
    }
  },

  // 3. Universal Targeted Notifications & Post-Update Logic
  async afterUpdate(event) {
    const { result, state } = event;
    const oldData = state.oldData;

    if (!oldData) return; // Safety fallback

    // 🛡️ CRITICAL FIX: Wrapped in try/catch to prevent breaking the API if a notification fails
    const notifyUniqueUser = async (userId, payload) => {
      if (!userId) return;
      try {
        await strapi.db.query('api::notification.notification').create({
          data: {
            ...payload,
            user: userId,
            activitySession: result.id, 
            publishedAt: new Date(), 
          },
        });
      } catch (error) {
        strapi.log.error(`Failed to create notification for user ${userId}:`, error.message);
      }
    };

    // Extract exactly who is involved in this session
    const studentId = oldData.student?.id;
    const therapistId = oldData.therapist?.id;
    
    // Fallback names for the UI messages
    const studentName = oldData.student?.firstName || 'The learner';
    const activityName = oldData.activity?.name || 'the activity';

    const oldStatus = oldData.activitySessionStatus;
    const newStatus = result.activitySessionStatus;

    // --------------------------------------------------------
    // SCENARIO 1: Session Started or Resumed
    // --------------------------------------------------------
    if (newStatus === 'in_progress' && oldStatus !== 'in_progress') {
      const isResume = oldStatus === 'paused';
      
      await notifyUniqueUser(studentId, {
        title: isResume ? 'Session Resumed! ▶️' : 'Session Started! 🚀',
        message: isResume ? `Your therapist resumed ${activityName}.` : `It's time to begin ${activityName}!`,
        type: 'lifecycle',
        priority: 'success'
      });
    }

    // --------------------------------------------------------
    // SCENARIO 2: Session Paused (By Learner or Therapist)
    // --------------------------------------------------------
    if (newStatus === 'paused' && oldStatus !== 'paused') {
      await notifyUniqueUser(studentId, {
        title: 'Session Paused ⏸️',
        message: `Your session for ${activityName} has been paused.`,
        type: 'lifecycle',
        priority: 'info'
      });
      await notifyUniqueUser(therapistId, {
        title: 'Session Paused',
        message: `${studentName} is currently paused on ${activityName}.`,
        type: 'lifecycle',
        priority: 'info'
      });
    }

    // --------------------------------------------------------
    // SCENARIO 3: Session Abandoned / Disconnected
    // --------------------------------------------------------
    if (newStatus === 'abandoned' && oldStatus !== 'abandoned') {
      await notifyUniqueUser(therapistId, {
        title: 'Session Abandoned ⚠️',
        message: `${studentName} disconnected from ${activityName} unexpectedly.`,
        type: 'lifecycle',
        priority: 'critical'
      });
      await notifyUniqueUser(studentId, {
        title: 'Session Closed',
        message: `Your session was closed. Please wait for your therapist to reconnect.`,
        type: 'lifecycle',
        priority: 'warning'
      });
    }

    // --------------------------------------------------------
    // SCENARIO 4: Session Completed & Instant Performance Evaluation
    // --------------------------------------------------------
    if (newStatus === 'completed' && oldStatus !== 'completed') {
      
      // Always congratulate the student immediately
      await notifyUniqueUser(studentId, {
        title: 'Activity Complete! 🎉',
        message: result.accuracy != null 
          ? `Great job! You scored ${result.accuracy}% on ${activityName}!` 
          : `Great job finishing ${activityName}!`,
        type: 'lifecycle',
        priority: 'success'
      });

      // Evaluate the score for the Therapist
      if (result.accuracy >= 95) {
        await notifyUniqueUser(therapistId, {
          title: 'High Performance Logged 🌟',
          message: `${studentName} finished ${activityName} with an outstanding ${result.accuracy}% accuracy. Data sent to AI.`,
          type: 'performance',
          priority: 'success'
        });
      } else if (result.accuracy !== null && result.accuracy <= 40) {
        await notifyUniqueUser(therapistId, {
          title: 'Session Review Recommended 📉',
          message: `${studentName} completed ${activityName} but scored ${result.accuracy}%. Data sent to AI for review.`,
          type: 'performance',
          priority: 'warning'
        });
      } else {
        await notifyUniqueUser(therapistId, {
          title: 'Session Concluded ✅',
          message: `${studentName} finished ${activityName} with ${result.accuracy != null ? result.accuracy + '%' : 'no score'}. Data sent to AI.`,
          type: 'lifecycle',
          priority: 'info'
        });
      }
    }

    // --------------------------------------------------------
    // SCENARIO 5: High Accuracy Milestone (Updated mid-session)
    // --------------------------------------------------------
    if (result.accuracy >= 95 && oldData.accuracy < 95 && newStatus !== 'completed') {
      await notifyUniqueUser(studentId, {
        title: 'Amazing Job! 🌟',
        message: `You hit ${result.accuracy}% on ${activityName}!`,
        type: 'performance',
        priority: 'success'
      });
      await notifyUniqueUser(therapistId, {
        title: 'High Performance Alert',
        message: `${studentName} achieved ${result.accuracy}% accuracy in ${activityName}.`,
        type: 'performance',
        priority: 'success'
      });
    }

    // --------------------------------------------------------
    // SCENARIO 6: AI Insights & Telemetry Generated
    // --------------------------------------------------------
    const hasNewAiInsight = result.aiRecommendation && !oldData.aiRecommendation;
    const hasNewTelemetry = result.telemetryAnalysis && !oldData.telemetryAnalysis;

    if (hasNewAiInsight && hasNewTelemetry) {
      await notifyUniqueUser(therapistId, {
        title: 'Comprehensive Analysis Ready 🧠📊',
        message: `Both AI recommendations and deep behavioral telemetry are now available for ${studentName}'s recent session.`,
        type: 'ai_insight',
        priority: 'info'
      });
    } else if (hasNewAiInsight) {
      await notifyUniqueUser(therapistId, {
        title: 'AI Clinical Insight Ready 🧠',
        message: `New AI-generated recommendations are available for ${studentName}'s recent session.`,
        type: 'ai_insight',
        priority: 'info'
      });
    } else if (hasNewTelemetry) {
      await notifyUniqueUser(therapistId, {
        title: 'Telemetry Analyzed 📊',
        message: `Deep behavioral analysis is now complete for ${studentName}'s session.`,
        type: 'ai_insight',
        priority: 'info'
      });
    }

   // --------------------------------------------------------
    // ✨ SCENARIO 7: Burn Passcode when the ISOLATED BLOCK is Empty ✨
    // --------------------------------------------------------
    const terminalStatuses = ['completed', 'abandoned', 'reschedule', 'cancelled'];
    const safeNewStatus = newStatus?.toLowerCase(); 

    if (terminalStatuses.includes(safeNewStatus) && oldStatus !== newStatus) {
        
        const safeStudentId = Number(studentId); 
        const currentPasscode = result.activitySessionPasscode;

        if (safeStudentId && currentPasscode) {
            try {
                // Check how many active games are left IN THIS SPECIFIC BLOCK ONLY
                const remainingInBlock = await strapi.db.query('api::activity-session.activity-session').count({
                    where: {
                        student: { id: safeStudentId }, 
                        activitySessionPasscode: currentPasscode, // 🎯 TARGET LOCK
                        activitySessionStatus: { $in: ['in_progress', 'queued', 'pending'] } 
                    }
                });

                strapi.log.info(`[Auth Security] Game ended in Block [${currentPasscode}]. Remaining in block: ${remainingInBlock}`);

                // If this specific block is empty, the therapy session is over. WIPE IT!
                if (remainingInBlock === 0) {
                    await strapi.db.query('plugin::users-permissions.user').update({
                        where: { id: safeStudentId },
                        data: {
                            activePasscode: "", 
                            passcodeExpiresAt: null,
                        }
                    });
                    
                    strapi.log.info(`[Auth Security] 🛑 BLOCK COMPLETE! Passcode wiped for student ID: ${safeStudentId}`);
                }
            } catch (error) {
                strapi.log.error(`[Auth Security] Failed to burn passcode: ${error.message}`);
            }
        }
    }
  } // End of afterUpdate
};