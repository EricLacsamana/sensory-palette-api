'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const { GoogleGenAI, Type } = require("@google/genai");

module.exports = createCoreService('api::activity-session.activity-session', ({ strapi }) => ({
  
  // --- AI RECOMMENDATION GENERATOR ---
  async generateAndSaveRecommendation(documentId) {
    try {
      // 1. Fetch the session data
      const session = await strapi.documents('api::activity-session.activity-session').findOne({
        documentId,
        populate: {
          activity: { populate: { categories: { fields: ['name'] } } },
          student: { fields: ['firstName'] },
        }
      });

      if (!session) throw new Error("Session not found");

      // 2. Fetch active activities for recommendations
      const activeActivities = await strapi.documents('api::activity.activity').findMany({
        filters: { activityStatus: 'active' },
        fields: ['name', 'documentId', 'activityType'],
        populate: { categories: { fields: ['name'] } }
      });

      const formattedActivities = activeActivities.map(a => ({
        id: a.documentId,
        name: a.name,
        type: a.activityType || 'unknown',
        categories: a.categories?.map(c => c.name).join(', ') || 'Uncategorized'
      }));

      // 3. Initialize AI and define the safe, SPED-aligned behavioral prompt
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `
        Role: Behavioral Pattern Analyst for Special Education (SPED)
        Task: Analyze raw telemetry to identify cognitive and learning patterns. Do NOT provide medical diagnoses.
        
        Instructions:
        1. Parse the JSON telemetry data.
        2. Return a JSON array "events" detailing the sequence of actions. 
        3. Each event MUST be: { "timestamp": "T+00s", "info": "Brief behavioral observation", "status": "SUCCESS" | "DELAY" | "ERROR" }.
        4. Calculate final Accuracy (0-100) as an integer.
        5. Provide a short behavioral insight focusing on learning styles and interactions.
        6. Suggest a Next Activity ID from the available list to best support the student's learning profile.
        7. Identify 1-3 "detectedPatterns". You MUST choose the pattern name from the following Approved Terminology list:
           - "Impulsive Responding"
           - "High Distractibility"
           - "Rapid Task-Switching"
           - "Hyperfocus"
           - "Repetitive Interaction Patterns"
           - "Rigid Task Execution"
           - "Prolonged Processing Time"
           - "Inconsistent Accuracy"
           - "Erratic Navigation"
           - "Sustained Attention"
           
        Each pattern must be an object containing the "pattern" name, a "confidence" level ("High", "Medium", or "Low"), and "evidence" (a brief explanation based on the telemetry data).

        Raw Data: ${JSON.stringify(session.rawTelemetry || {})}
        Available Activities: ${JSON.stringify(formattedActivities)}
      `;

      // 4. Generate AI Content with strict JSON Schema
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash", 
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              insight: { type: Type.STRING },
              nextActivityId: { type: Type.STRING },
              calculatedAccuracy: { type: Type.INTEGER },
              detectedPatterns: { 
                type: Type.ARRAY, 
                items: { 
                  type: Type.OBJECT,
                  properties: {
                    pattern: { type: Type.STRING },
                    confidence: { type: Type.STRING },
                    evidence: { type: Type.STRING }
                  },
                  required: ["pattern", "confidence", "evidence"]
                } 
              },
              events: { 
                type: Type.ARRAY, 
                items: { 
                  type: Type.OBJECT,
                  properties: {
                    timestamp: { type: Type.STRING },
                    info: { type: Type.STRING },
                    status: { type: Type.STRING }
                  }
                }
              }
            },
            required: ["insight", "nextActivityId", "calculatedAccuracy", "detectedPatterns", "events"]
          }
        }
      });

      // 5. Safely parse JSON (Bulletproof markdown stripping)
      const rawText = result.text || "";
      const cleanJsonText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const aiData = JSON.parse(cleanJsonText);

      // 6. Update the Draft Document
      await strapi.documents('api::activity-session.activity-session').update({
        documentId,
        data: {
          aiRecommendation: aiData.insight, 
          aiRecommendationId: aiData.nextActivityId,
          accuracy: Math.round(aiData.calculatedAccuracy), // Bulletproof rounding safeguard
          telemetryAnalysis: aiData.events, 
          behavioralIndicators: aiData.detectedPatterns // Saves the array of JSON objects to Strapi
        }
      });

      // 7. Publish the Document (Strapi 5 workflow)
      return await strapi.documents('api::activity-session.activity-session').publish({
        documentId
      });

    } catch (error) {
      // 8. Log the actual error object so Pino doesn't swallow it
      strapi.log.error(`--- AI PROCESSING ERROR --- ${error.message}`, error);
      return { success: false, error: error.message };
    }
  },

  // --- CORE ANALYTICS GENERATOR ---
// --- CORE ANALYTICS GENERATOR ---
  async generateDashboardMetrics({ startDate, endDate, studentId, therapistId }) {
    
    // 1. Get Total Registered Students (Filtered by Therapist if applicable)
    const studentQueryWhere = {
      role: { type: 'student' } // Adjust to match your exact role type or name
    };
    
    if (therapistId) {
      studentQueryWhere.therapist = { id: therapistId };
    }

    const totalRegisteredStudents = await strapi.query('plugin::users-permissions.user').count({
      where: studentQueryWhere
    });

    // 2. Setup Filters for Sessions
    const filters = { actualStartAt: { $notNull: true } };
    
    // Initialize student filter object
    filters.student = {};

    if (studentId) {
        filters.student.id = { $eq: studentId }; 
    }
    
    // NEW: Deep filter to only include sessions where the student's therapist matches
    if (therapistId) {
        filters.student.therapist = { id: { $eq: therapistId } };
    }

    // Clean up empty student filter if neither ID was passed
    if (Object.keys(filters.student).length === 0) {
        delete filters.student;
    }
    
    if (startDate && endDate) {
      filters.actualStartAt = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      filters.actualStartAt = { $gte: startDate };
    }

    // 3. Fetch Sessions
    const sessions = await strapi.documents('api::activity-session.activity-session').findMany({
      filters,
      populate: ['activity', 'student'],
      sort: 'actualStartAt:asc',
      status: 'published'
    });
    
    if (!sessions.length) return { 
      message: "No data found for this period.",
      overviewMetrics: { totalStudentsRegistered: totalRegisteredStudents }
    };

    // 4. Initialize Accumulators
    let totalScore = 0, validScoreCount = 0;
    let totalAccuracy = 0, validAccuracyCount = 0;
    let totalTimeMs = 0;
    let completedCount = 0;

    const activeStudentsInPeriod = new Set();
    const timelineMap = {};
    const activityTypeMap = {};
    const topActivitiesMap = {};
    const behavioralMap = {};

    // 5. Process Loop
    sessions.forEach(session => {
      // Track unique active students
      if (session.student?.id) {
        activeStudentsInPeriod.add(session.student.id);
      }

      // Overview Metrics
      if (session.score != null) { totalScore += session.score; validScoreCount++; }
      if (session.accuracy != null) { totalAccuracy += session.accuracy; validAccuracyCount++; }
      if (session.actualStartAt && session.actualEndAt) {
        totalTimeMs += new Date(session.actualEndAt) - new Date(session.actualStartAt);
      }
      if (session.activitySessionStatus === 'completed') completedCount++;

      // Timeline Grouping
      const day = new Date(session.actualStartAt).toISOString().split('T')[0];
      if (!timelineMap[day]) timelineMap[day] = { count: 0, totalScore: 0, totalAccuracy: 0 };
      timelineMap[day].count++;
      timelineMap[day].totalScore += session.score || 0;
      timelineMap[day].totalAccuracy += session.accuracy || 0;

      // Activity Breakdown
      if (session.activity) {
        const type = session.activity.activityType || 'unknown';
        activityTypeMap[type] = (activityTypeMap[type] || 0) + 1;

        const actName = session.activity.name || 'Unnamed';
        if (!topActivitiesMap[actName]) {
          topActivitiesMap[actName] = { type, count: 0, totalScore: 0 };
        }
        topActivitiesMap[actName].count++;
        topActivitiesMap[actName].totalScore += session.score || 0;
      }

      // Behavioral Radar
      if (Array.isArray(session.behavioralIndicators)) {
        session.behavioralIndicators.forEach(ind => {
          const score = ind.confidence === 'High' ? 90 : ind.confidence === 'Medium' ? 60 : 30;
          if (!behavioralMap[ind.pattern]) behavioralMap[ind.pattern] = { total: 0, count: 0 };
          behavioralMap[ind.pattern].total += score;
          behavioralMap[ind.pattern].count++;
        });
      }
    });

    // 6. Format Output
    return {
      overviewMetrics: {
        totalStudentsRegistered: totalRegisteredStudents, 
        activeStudentsInPeriod: activeStudentsInPeriod.size,
        totalSessionsCompleted: completedCount,
        averageScore: validScoreCount ? Math.round(totalScore / validScoreCount) : 0,
        averageAccuracy: validAccuracyCount ? Math.round(totalAccuracy / validAccuracyCount) : 0,
        totalTherapyHours: parseFloat((totalTimeMs / 3600000).toFixed(2)),
        completionRate: parseFloat(((completedCount / sessions.length) * 100).toFixed(1))
      },
      charts: {
        performanceTimeline: Object.keys(timelineMap).map(date => ({
          date,
          sessionCount: timelineMap[date].count,
          avgScore: Math.round(timelineMap[date].totalScore / timelineMap[date].count),
          avgAccuracy: Math.round(timelineMap[date].totalAccuracy / timelineMap[date].count)
        })),
        activityTypeDistribution: Object.keys(activityTypeMap).map(type => ({
          activityType: type,
          sessionCount: activityTypeMap[type],
          percentage: parseFloat(((activityTypeMap[type] / sessions.length) * 100).toFixed(1))
        })),
        behavioralRadar: Object.keys(behavioralMap).map(pattern => {
          const avgScore = Math.round(behavioralMap[pattern].total / behavioralMap[pattern].count);
          return {
            pattern,
            intensityScore: avgScore,
            confidence: avgScore >= 75 ? 'High' : avgScore >= 45 ? 'Medium' : 'Low'
          };
        }),
        topActivities: Object.keys(topActivitiesMap)
          .map(name => ({
            activityName: name,
            activityType: topActivitiesMap[name].type,
            usageCount: topActivitiesMap[name].count,
            avgStudentScore: Math.round(topActivitiesMap[name].totalScore / topActivitiesMap[name].count)
          }))
          .sort((a, b) => b.usageCount - a.usageCount)
          .slice(0, 5)
      }
    };
  },

  // --- COMPARISON GENERATOR ---
async generateComparisonMetrics({ baseStudent, compareStudent, startDate, endDate, therapistId }) {
    // Pass therapistId down to ensure restricted access
    const studentAData = await this.generateDashboardMetrics({ 
      studentId: baseStudent, startDate, endDate, therapistId 
    });
    const studentBData = await this.generateDashboardMetrics({ 
      studentId: compareStudent, startDate, endDate, therapistId 
    });

    const sharedActivities = [];
    if (studentAData.charts && studentBData.charts) {
        studentAData.charts.topActivities.forEach(actA => {
            const actB = studentBData.charts.topActivities.find(b => b.activityName === actA.activityName);
            if (actB) {
                sharedActivities.push({
                    activityName: actA.activityName,
                    activityType: actA.activityType,
                    baseStudentScore: actA.avgStudentScore,
                    compareStudentScore: actB.avgStudentScore,
                    difference: actA.avgStudentScore - actB.avgStudentScore
                });
            }
        });
    }

    return {
      meta: {
        comparisonType: compareStudent ? 'Student vs Student' : 'Student vs Global Average'
      },
      baseStudentMetrics: studentAData.overviewMetrics || null,
      compareStudentMetrics: studentBData.overviewMetrics || null,
      activityHeadToHead: sharedActivities,
      behavioralOverlap: {
          baseStudentRadar: studentAData.charts?.behavioralRadar || [],
          compareStudentRadar: studentBData.charts?.behavioralRadar || []
      }
    };
  }

}));