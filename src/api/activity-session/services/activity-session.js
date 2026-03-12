'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const { GoogleGenAI, Type } = require("@google/genai");

// ✨ BULLETPROOF TIME CALCULATOR: "Additive Active Intervals"
const calculateEngagedTime = (timeLogs, actualStartAt, actualEndAt, status) => {
    if (!actualStartAt) return 0;
    
    let logs = Array.isArray(timeLogs) ? [...timeLogs] : [];
    
    // 1. Build a chronological stream of events
    const events = logs.map(l => ({
        action: l.status, // 'start', 'pause', 'resume'
        time: new Date(l.timestamp).getTime()
    }));

    // 2. Guarantee we have a baseline 'start' event
    const startMs = new Date(actualStartAt).getTime();
    if (!events.find(e => e.action === 'start' && e.time === startMs)) {
        events.push({ action: 'start', time: startMs });
    }
    
    // Sort chronologically
    events.sort((a, b) => a.time - b.time);

    let totalEngagedMs = 0;
    let currentActiveStartMs = null;

    // 3. Process the timeline additively
    events.forEach(event => {
        if (event.action === 'start' || event.action === 'resume') {
            // Start the clock if it isn't already running
            if (currentActiveStartMs === null) {
                currentActiveStartMs = event.time;
            }
        } else if (event.action === 'pause') {
            // Stop the clock and add the elapsed active time
            if (currentActiveStartMs !== null) {
                const activeDuration = event.time - currentActiveStartMs;
                if (activeDuration > 0) totalEngagedMs += activeDuration;
                currentActiveStartMs = null;
            }
        }
    });

    // 4. Handle dangling active states (e.g., session ended without a prior 'pause' log)
    if (currentActiveStartMs !== null) {
        if (actualEndAt) {
            // Session is officially over, cap at actualEndAt
            const endMs = new Date(actualEndAt).getTime();
            if (endMs > currentActiveStartMs) {
                totalEngagedMs += (endMs - currentActiveStartMs);
            }
        } else if (status === 'in_progress') {
            // ONLY use Date.now() if the session is physically live right now!
            // This prevents old, bugged sessions from accumulating thousands of hours.
            totalEngagedMs += (Date.now() - currentActiveStartMs);
        }
    }

    return Math.max(0, Math.floor(totalEngagedMs / 1000));
};

module.exports = createCoreService('api::activity-session.activity-session', ({ strapi }) => ({
  
  // --- AI RECOMMENDATION GENERATOR ---
  async generateAndSaveRecommendation(documentId) {
    try {
      const session = await strapi.documents('api::activity-session.activity-session').findOne({
        documentId,
        populate: {
          activity: { populate: { categories: { fields: ['name'] } } },
          student: { fields: ['firstName', 'dateOfBirth'] }, 
        }
      });

      if (!session) throw new Error("Session not found");

      let studentAge = 'Unknown';
      if (session.student?.dateOfBirth) {
        const dob = new Date(session.student.dateOfBirth);
        const ageDifMs = Date.now() - dob.getTime();
        const ageDate = new Date(ageDifMs);
        studentAge = Math.abs(ageDate.getUTCFullYear() - 1970);
      }

      const studentName = session.student?.firstName || 'The student';

      const activeActivities = await strapi.documents('api::activity.activity').findMany({
        filters: { activityStatus: 'active' },
        fields: ['name', 'documentId'],
        populate: { categories: { fields: ['name'] } }
      });

      const formattedActivities = activeActivities.map(a => ({
        id: a.documentId,
        name: a.name,
        categories: a.categories?.map((c) => c.name).join(', ') || 'Uncategorized'
      }));

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `
        Role: Behavioral Pattern Analyst for Special Education (SPED)
        Task: Analyze raw telemetry to identify cognitive and learning patterns. Do NOT provide medical diagnoses.
        
        Context: 
        - Learner: ${studentName} (Age: ${studentAge})
        - Overall Accuracy: ${session.accuracy || 'Unknown'}%
        - Environment: Adaptive Difficulty was ${session.enableAdaptiveDifficulty ? 'ENABLED' : 'DISABLED'}. 
        - Hands-Free Flow: ${session.isHandsFree ? 'ENABLED (Instant transition)' : 'DISABLED (Manual start)'}.
        - Therapist Time Adjustment: ${session.extraTimeSeconds || 0} seconds added/removed.
        
        Instructions:
        1. Parse the JSON telemetry data.
        2. Return a JSON array "events" detailing the sequence of actions. 
        3. Each event MUST be: { "timestamp": "T+00s", "info": "Brief behavioral observation", "status": "SUCCESS" | "DELAY" | "ERROR" }.
        4. Provide a short behavioral insight focusing on ${studentName}'s learning styles and interactions explaining WHY they got that accuracy.
        5. Suggest a Next Activity ID from the available list to best support their learning profile.
        6. Identify 1-3 "detectedPatterns". You MUST choose the pattern name from the following Approved Terminology list:
           - "Impulsive Responding"
           - "High Distractibility"
           - "Rapid Task-Switching"
           - "Hyperfocus"
           - "Repetitive Interaction Patterns"
           - "Rigid Task Execution"
           - "Prolonged Processing Time"
           - "Inconsistent Accuracy"
           - "Sustained Attention"
        6: Generate percentage "aiAccuracy" 0-100 NUMBER based on raw telemetry data.
        Each pattern must be an object containing the "pattern" name, a "confidence" level ("High", "Medium", or "Low"), and "evidence" (a brief explanation based on the telemetry data).

        Raw Telemetry Data: ${JSON.stringify(session.rawTelemetry || {})}
        Time Logs: ${JSON.stringify(session.timeLogs || {})}
        
        Activity Recommendations:
        - You can suggest the next available online activity from this list: ${JSON.stringify(formattedActivities)}
        - You MUST also suggest off-screen, offline activities (e.g., daily living tasks, movement exercises, sensory activities). 
        - CRITICAL: Ensure all offline recommendations are strictly developmentally appropriate for a ${studentAge}-year-old.
      `;

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
              aiAccuracy: { type: Type.INTEGER },
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
            required: ["insight", "nextActivityId", "detectedPatterns", "events"]
          }
        }
      });

      const rawText = result.text || "";
      const cleanJsonText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const aiData = JSON.parse(cleanJsonText);

      await strapi.documents('api::activity-session.activity-session').update({
        documentId,
        data: {
          aiRecommendation: aiData.insight, 
          aiRecommendationId: aiData.nextActivityId,
          aiAccuracy: aiData.aiAccuracy,
          telemetryAnalysis: aiData.events, 
          behavioralIndicators: aiData.detectedPatterns
        }
      });

      return await strapi.documents('api::activity-session.activity-session').publish({
        documentId
      });

    } catch (error) {
      strapi.log.error(`--- AI PROCESSING ERROR --- ${error.message}`, error);
      return { success: false, error: error.message };
    }
  },

  // --- CORE ANALYTICS GENERATOR ---
  async generateDashboardMetrics({ startDate, endDate, studentId, therapistId }) {
    
    // Total Students Filter
    const studentQueryWhere = { role: { type: 'student' } };
    if (therapistId) studentQueryWhere.therapist = { id: Number(therapistId) };

    const totalRegisteredStudents = await strapi.query('plugin::users-permissions.user').count({
      where: studentQueryWhere
    });

    // Session Filters
    const filters = { actualStartAt: { $notNull: true } };
    
    if (studentId) filters.student = { id: { $eq: Number(studentId) } }; 
    if (therapistId) filters.therapist = { id: { $eq: Number(therapistId) } };

    // Append start-of-day and end-of-day times so "today" doesn't get cut off at midnight
    if (startDate && endDate) {
      filters.actualStartAt = { 
        $gte: startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`, 
        $lte: endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z` 
      };
    } else if (startDate) {
      filters.actualStartAt = { 
        $gte: startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z` 
      };
    }

    const sessions = await strapi.documents('api::activity-session.activity-session').findMany({
      filters,
      populate: {
          activity: { populate: ['categories'] },
          student: true,
          therapist: true
      },
      sort: 'actualStartAt:asc',
      status: 'published'
    });
    
    if (!sessions.length) return { 
      message: "No data found for this period.",
      overviewMetrics: { totalStudentsRegistered: totalRegisteredStudents }
    };

    let totalScore = 0, validScoreCount = 0;
    let totalAccuracy = 0, validAccuracyCount = 0;
    let totalTimeSeconds = 0;
    let completedCount = 0;

    const activeStudentsInPeriod = new Set();
    const timelineMap = {};
    const activityCategoryMap = {};
    const topActivitiesMap = {};
    const behavioralMap = {};

    sessions.forEach(session => {
      if (session.student?.id) activeStudentsInPeriod.add(session.student.id);

      if (session.score != null) { totalScore += session.score; validScoreCount++; }
      if (session.accuracy != null) { totalAccuracy += session.accuracy; validAccuracyCount++; }
      
      const elapsedSecs = calculateEngagedTime(
          session.timeLogs, 
          session.actualStartAt, 
          session.actualEndAt, 
          session.activitySessionStatus
      );
      totalTimeSeconds += elapsedSecs;

      if (session.activitySessionStatus === 'completed') completedCount++;

      const day = new Date(session.actualStartAt).toISOString().split('T')[0];
      if (!timelineMap[day]) timelineMap[day] = { count: 0, totalScore: 0, totalAccuracy: 0 };
      timelineMap[day].count++;
      timelineMap[day].totalScore += session.score || 0;
      timelineMap[day].totalAccuracy += session.accuracy || 0;

      if (session.activity) {
        const categories = session.activity.categories || [];
        const primaryCategoryName = categories.length > 0 ? categories[0].name : 'Uncategorized';
        
        activityCategoryMap[primaryCategoryName] = (activityCategoryMap[primaryCategoryName] || 0) + 1;

        const actName = session.activity.name || 'Unnamed';
        if (!topActivitiesMap[actName]) {
          topActivitiesMap[actName] = { type: primaryCategoryName, count: 0, totalScore: 0 };
        }
        topActivitiesMap[actName].count++;
        topActivitiesMap[actName].totalScore += session.score || 0;
      }

      if (Array.isArray(session.behavioralIndicators)) {
        session.behavioralIndicators.forEach(ind => {
          const score = ind.confidence === 'High' ? 90 : ind.confidence === 'Medium' ? 60 : 30;
          if (!behavioralMap[ind.pattern]) behavioralMap[ind.pattern] = { total: 0, count: 0 };
          behavioralMap[ind.pattern].total += score;
          behavioralMap[ind.pattern].count++;
        });
      }
    });

    return {
      overviewMetrics: {
        totalStudentsRegistered: totalRegisteredStudents, 
        activeStudentsInPeriod: activeStudentsInPeriod.size,
        totalSessionsCompleted: completedCount,
        averageScore: validScoreCount ? Math.round(totalScore / validScoreCount) : 0,
        averageAccuracy: validAccuracyCount ? Math.round(totalAccuracy / validAccuracyCount) : 0,
        totalTherapyHours: parseFloat((totalTimeSeconds / 3600).toFixed(2)),
        completionRate: parseFloat(((completedCount / sessions.length) * 100).toFixed(1))
      },
      charts: {
        performanceTimeline: Object.keys(timelineMap).map(date => ({
          date,
          sessionCount: timelineMap[date].count,
          avgScore: Math.round(timelineMap[date].totalScore / timelineMap[date].count),
          avgAccuracy: Math.round(timelineMap[date].totalAccuracy / timelineMap[date].count)
        })),
        activityTypeDistribution: Object.keys(activityCategoryMap).map(category => ({
          activityType: category, 
          sessionCount: activityCategoryMap[category],
          percentage: parseFloat(((activityCategoryMap[category] / sessions.length) * 100).toFixed(1))
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

  async generateComparisonMetrics({ baseStudent, compareStudent, startDate, endDate, therapistId }) {
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
  },
  
  // ✨ CUSTOM PASSCODE LOGIC ✨
  async generateStudentPasscode(studentId, sessionIds, extraTimeSeconds) {
        if (!studentId) throw new Error('Cannot generate passcode: studentId is undefined');

        const safeStudentId = Number(studentId); 

        // 1. Fetch the student first
        const student = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: safeStudentId },
            select: ['id', 'activePasscode', 'passcodeExpiresAt']
        });

        if (!student) throw new Error(`Student with ID ${safeStudentId} not found`);

        const now = new Date();
        let finalPasscode = student.activePasscode; // Default to current PIN
        let needsNewPin = false;

        // 2. Determine if we need a new PIN
        if (!student.activePasscode || !student.passcodeExpiresAt) {
            needsNewPin = true;
        } else {
            const expiresDate = new Date(student.passcodeExpiresAt);
            if (expiresDate <= now) {
                needsNewPin = true;
            }
        }

        // 3. Generate new PIN if required
        if (needsNewPin) {
            finalPasscode = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + (4 * 60 * 60 * 1000)); // 4 hours

            await strapi.db.query('plugin::users-permissions.user').update({
                where: { id: safeStudentId },
                data: {
                    activePasscode: finalPasscode,
                    passcodeExpiresAt: expiresAt,
                }
            });
            strapi.log.info(`[Auth Generator] ✨ NEW PIN: ${finalPasscode}`);
        } else {
            strapi.log.info(`[Auth Generator] ♻️ REUSING PIN: ${finalPasscode}`);
        }

        // 4. ✨ THE CRITICAL FIX: Guard the updateMany ✨
        if (!finalPasscode) {
            strapi.log.error('[Auth Generator] Critical Failure: No passcode available to tag sessions.');
            return null;
        }

        try {
            await strapi.db.query('api::activity-session.activity-session').updateMany({
                where: {
                    student: safeStudentId, 
                    activitySessionStatus: { $in: ['in_progress', 'queued', 'pending'] }
                },
                data: { 
                    activitySessionPasscode: finalPasscode 
                }
            });
        } catch (dbError) {
            strapi.log.error(`[Auth Generator] Database tagging failed: ${dbError.message}`);
        }

        return finalPasscode; 
    }
}));