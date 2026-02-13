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
}));