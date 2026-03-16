'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::activity-session.activity-session', ({ strapi }) => ({
  async triggerAiRecommendation(ctx) {
    const { id } = ctx.params; // This is the documentId in Strapi v5

    try {
      // 1. Call your service to do the heavy lifting
      const updatedRecord = await strapi
        .service('api::activity-session.activity-session')
        .generateAndSaveRecommendation(id);

      // 2. Return the updated record with the new recommendation fields
      ctx.body = {
        message: "AI Recommendation generated successfully",
        data: updatedRecord
      };
    } catch (err) {
      strapi.log.error('AI recommendation error:', err);
      ctx.throw(500, "Failed to generate AI recommendation");
    }
  },
async generateStudentPasscode(studentIdentifier, sessionIds = [], extraTimeSeconds = 0) {
        if (!studentIdentifier) {
            strapi.log.error('[Auth Generator] Missing student identifier');
            return null;
        }

        try {
            strapi.log.info(`[Auth Generator] Processing PIN request for student: ${studentIdentifier}`);

            // 1. Safely find the student whether we were given a Number ID or Document ID
            const isDocId = isNaN(Number(studentIdentifier));
            
            const students = await strapi.entityService.findMany('plugin::users-permissions.user', {
                filters: isDocId ? { documentId: studentIdentifier } : { id: studentIdentifier },
                limit: 1
            });
            
            if (!students || students.length === 0) {
                strapi.log.error(`[Auth Generator] Student ${studentIdentifier} not found in DB!`);
                return null;
            }
            
            const student = students[0];
            const numericStudentId = student.id;

            const now = new Date();
            let finalPasscode = student.activePasscode;
            let needsNewPin = false;

            // 2. Check if PIN is missing or expired
            if (!student.activePasscode || !student.passcodeExpiresAt) {
                needsNewPin = true;
            } else {
                const expiresDate = new Date(student.passcodeExpiresAt);
                if (expiresDate <= now) {
                    needsNewPin = true;
                }
            }

            // 3. Generate and Save New PIN
            if (needsNewPin) {
                finalPasscode = Math.floor(100000 + Math.random() * 900000).toString();
                const expiresAt = new Date(Date.now() + (4 * 60 * 60 * 1000)); // Valid for 4 hours

                await strapi.entityService.update('plugin::users-permissions.user', numericStudentId, {
                    data: {
                        activePasscode: finalPasscode,
                        passcodeExpiresAt: expiresAt,
                    }
                });
                strapi.log.info(`[Auth Generator] ✨ NEW PIN GENERATED: ${finalPasscode}`);
            } else {
                strapi.log.info(`[Auth Generator] ♻️ REUSING ACTIVE PIN: ${finalPasscode}`);
            }

            // 4. Tag the sessions with the PIN string (if you use this fallback in your schema)
            if (finalPasscode) {
                await strapi.db.query('api::activity-session.activity-session').updateMany({
                    where: {
                        student: numericStudentId,
                        activitySessionStatus: { $in: ['in_progress', 'queued', 'pending'] }
                    },
                    data: { activitySessionPasscode: finalPasscode }
                });
            }

            return finalPasscode;

        } catch (error) {
            strapi.log.error(`[Auth Generator] Fatal Error: ${error.message}`);
            return null;
        }
    }
}));