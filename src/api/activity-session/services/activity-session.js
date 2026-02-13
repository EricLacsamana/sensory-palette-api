'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const { GoogleGenAI } = require("@google/genai");

module.exports = createCoreService('api::activity-session.activity-session', ({ strapi }) => ({
  async generateAndSaveRecommendation(documentId) {
    try {
      // 1. Fetch Session Data
      const session = await strapi.documents('api::activity-session.activity-session').findOne({
        documentId,
        populate: {
          activity: { fields: ['name', 'masteryThreshold'] },
          student: { fields: ['firstName'] },
        }
      });

      if (!session) throw new Error("Session not found");

      // 2. Fetch Active Activities list
      const activeActivities = await strapi.documents('api::activity.activity').findMany({
        filters: { activityStatus: 'active' },
        fields: ['name', 'documentId']
      });

      // 3. Initialize Gemini 3
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      // 4. Detailed Prompt with Length constraint
      const prompt = `
        Role: Clinical Therapy Assistant
        Analyze session for: ${session.student?.firstName}
        Current Activity: ${session.activity?.name}
        Score: ${session.actualScore}% (Threshold: ${session.activity?.masteryThreshold}%)
        Latency: ${session.avgLatency}ms
        Notes: ${session.teacherNotes || 'None'}

        Available Activities: ${JSON.stringify(activeActivities.map(a => ({ id: a.documentId, name: a.name })))}
        
        Task: Provide a clinical insight (max 250 chars) and pick the next activity ID.
        Return ONLY JSON: {"insight": "text", "nextActivityId": "documentId"}
      `;

      // 5. Generate with Gemini 3 Flash
      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });

      // 6. Safe Parsing
      const aiData = JSON.parse(result.text);

      // 7. Update with "Safety Trimmer"
      // Even if the DB is still VARCHAR(255), substring(0, 250) prevents the crash
      return await strapi.documents('api::activity-session.activity-session').update({
        documentId,
        data: {
          aiRecommendation: aiData.insight.substring(0, 500), // Truncate to 500 for 'Text' fields
          recommendationActivity: aiData.nextActivityId,
        },
        status: 'published'
      });

    } catch (error) {
      strapi.log.error("--- GEMINI 3 FINAL ERROR HANDLER ---");
      strapi.log.error(error.message);
      
      // If parsing or DB fails, we still return a 200 to the frontend with an error status
      return { 
        success: false, 
        error: "DATABASE_OR_AI_LIMIT",
        details: error.message 
      };
    }
  }
}));