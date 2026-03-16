'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const { GoogleGenAI, Type } = require("@google/genai");

const calculateEngagedTime = (timeLogs, actualStartAt, actualEndAt, status) => {
    if (!actualStartAt) return 0;
    
    let logs = Array.isArray(timeLogs) ? [...timeLogs] : [];
    const events = logs.map(l => ({
        action: l.status,
        time: new Date(l.timestamp).getTime()
    }));

    const startMs = new Date(actualStartAt).getTime();
    if (!events.find(e => e.action === 'start' && e.time === startMs)) {
        events.push({ action: 'start', time: startMs });
    }
    
    events.sort((a, b) => a.time - b.time);

    let totalEngagedMs = 0;
    let currentActiveStartMs = null;

    events.forEach(event => {
        if (event.action === 'start' || event.action === 'resume') {
            if (currentActiveStartMs === null) {
                currentActiveStartMs = event.time;
            }
        } else if (event.action === 'pause') {
            if (currentActiveStartMs !== null) {
                const activeDuration = event.time - currentActiveStartMs;
                if (activeDuration > 0) totalEngagedMs += activeDuration;
                currentActiveStartMs = null;
            }
        }
    });

    if (currentActiveStartMs !== null) {
        if (actualEndAt) {
            const endMs = new Date(actualEndAt).getTime();
            if (endMs > currentActiveStartMs) {
                totalEngagedMs += (endMs - currentActiveStartMs);
            }
        } else if (status === 'in_progress') {
            totalEngagedMs += (Date.now() - currentActiveStartMs);
        }
    }

    return Math.max(0, Math.floor(totalEngagedMs / 1000));
};

module.exports = createCoreService('api::activity-session.activity-session', ({ strapi }) => ({
  
  async generateAndSaveRecommendation(documentId) {
    try {
      const session = await strapi.documents('api::activity-session.activity-session').findOne({
        documentId,
        populate: {
          activity: { populate: ['categories'] }, 
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

      const isGame = session.activity?.activityType?.toLowerCase() === 'game';
      let gameStatsContext = '';
      
      if (isGame) {
          const engagedSecs = calculateEngagedTime(session.timeLogs, session.actualStartAt, session.actualEndAt, session.activitySessionStatus);
          const mins = Math.floor(engagedSecs / 60);
          const secs = engagedSecs % 60;
          const timeString = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

          gameStatsContext = `
        - Game Performance Data:
          * Score (Correct Answers): ${session.score ?? 0}
          * Total Rounds (Attempts): ${session.rounds ?? 0}
          * Accuracy: ${session.accuracy ?? 0}%
          * Actual Time Spent Active (Excluding Pauses): ${timeString}`;
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `
        Role: Behavioral Pattern Analyst for Special Education (SPED)
        Task: Analyze raw telemetry to identify cognitive and learning patterns. Do NOT provide medical diagnoses.
        
        Context: 
        - Learner: ${studentName} (Age: ${studentAge})
        - Environment: Adaptive Difficulty was ${session.enableAdaptiveDifficulty ? 'ENABLED' : 'DISABLED'}. 
        - Hands-Free Flow: ${session.isHandsFree ? 'ENABLED (Instant transition)' : 'DISABLED (Manual start)'}.
        - Therapist Time Adjustment: ${session.extraTimeSeconds || 0} seconds added/removed.${gameStatsContext}
        
        Instructions:
        1. Parse the JSON telemetry data.
        2. Return a JSON array "events" detailing the sequence of actions. 
        3. Each event MUST be: { "timestamp": "T+00s", "info": "Brief behavioral observation", "status": "SUCCESS" | "DELAY" | "ERROR" }.
        4. Provide a short behavioral insight focusing on ${studentName}'s learning styles and interactions explaining WHY they got that accuracy/score. Note their speed vs precision.
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
        7: Generate percentage "aiAccuracy" 0-100 NUMBER representing your confidence in their actual understanding based on raw telemetry.
        Each pattern must be an object containing the "pattern" name, a "confidence" level ("High", "Medium", or "Low"), and "evidence" (a brief explanation based on the telemetry data).

        Raw Telemetry Data: ${JSON.stringify(session.rawTelemetry || {})}
        Time Logs: ${JSON.stringify(session.timeLogs || {})}
        
        Activity Recommendations:
        - You can suggest the next available online activity from this list: ${JSON.stringify(formattedActivities)}
        - You MUST also suggest off-screen, offline activities (e.g., daily living tasks, movement exercises, sensory activities). 
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
    const studentQueryWhere = { role: { type: 'student' } };
    if (therapistId) studentQueryWhere.therapist = { id: Number(therapistId) };

    const totalRegisteredStudents = await strapi.query('plugin::users-permissions.user').count({
      where: studentQueryWhere
    });

    const filters = { actualStartAt: { $notNull: true } };
    if (studentId) filters.student = { id: { $eq: Number(studentId) } }; 
    if (therapistId) filters.therapist = { id: { $eq: Number(therapistId) } };

    // Set Timezone-safe boundaries
    const startBoundary = new Date(`${startDate.split('T')[0]}T00:00:00`);
    const endBoundary = new Date(`${endDate.split('T')[0]}T23:59:59.999`);

    filters.actualStartAt = { 
      $gte: startBoundary.toISOString(), 
      $lte: endBoundary.toISOString() 
    };

    const sessions = await strapi.documents('api::activity-session.activity-session').findMany({
      filters,
      populate: { activity: { populate: ['categories'] }, student: true, therapist: true },
      sort: 'actualStartAt:asc',
      status: 'published'
    });

    // 1. GENERATE ALL DATES IN RANGE (Ensures 0s are returned for empty days)
    const timelineMap = {};
    let cursor = new Date(startBoundary);
    while (cursor <= endBoundary) {
      const dayKey = cursor.toISOString().split('T')[0];
      timelineMap[dayKey] = { count: 0, totalScore: 0, totalAccuracy: 0, totalRounds: 0 };
      cursor.setDate(cursor.getDate() + 1);
    }

    let totalScore = 0, validScoreCount = 0;
    let totalAccuracy = 0, validAccuracyCount = 0;
    let totalRounds = 0; 
    let totalTimeSeconds = 0;
    let completedCount = 0;
    const activeStudentsInPeriod = new Set();
    const activityCategoryMap = {};
    const topActivitiesMap = {};
    const behavioralMap = {};

    // 2. FILL DATA FROM SESSIONS
    sessions.forEach(session => {
      if (session.student?.id) activeStudentsInPeriod.add(session.student.id);
      if (session.score != null) { totalScore += session.score; validScoreCount++; }
      if (session.accuracy != null) { totalAccuracy += session.accuracy; validAccuracyCount++; }
      if (session.rounds != null) { totalRounds += session.rounds; } 
      
      const elapsedSecs = calculateEngagedTime(session.timeLogs, session.actualStartAt, session.actualEndAt, session.activitySessionStatus);
      totalTimeSeconds += elapsedSecs;

      if (session.activitySessionStatus === 'completed') completedCount++;

      const day = new Date(session.actualStartAt).toISOString().split('T')[0];
      if (timelineMap[day]) {
        timelineMap[day].count++;
        timelineMap[day].totalScore += session.score || 0;
        timelineMap[day].totalAccuracy += session.accuracy || 0;
        timelineMap[day].totalRounds += session.rounds || 0;
      }

      if (session.activity) {
        const categories = session.activity.categories || [];
        const primaryCategoryName = categories.length > 0 ? categories[0].name : 'Uncategorized';
        activityCategoryMap[primaryCategoryName] = (activityCategoryMap[primaryCategoryName] || 0) + 1;
        const actName = session.activity.name || 'Unnamed';
        if (!topActivitiesMap[actName]) {
          topActivitiesMap[actName] = { type: primaryCategoryName, count: 0, totalScore: 0, totalAccuracy: 0 };
        }
        topActivitiesMap[actName].count++;
        topActivitiesMap[actName].totalScore += session.score || 0;
        topActivitiesMap[actName].totalAccuracy += session.accuracy || 0;
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

    // 3. DYNAMIC AGGREGATION LOGIC (Daily vs Weekly vs Monthly)
    const dateKeys = Object.keys(timelineMap).sort();
    const rangeInDays = dateKeys.length;
    let finalTimeline = [];

    if (rangeInDays > 60) {
      // Aggregate by Month if range is > 60 days
      const monthlyMap = {};
      dateKeys.forEach(date => {
        const monthKey = date.substring(0, 7); // YYYY-MM
        if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { count: 0, totalAcc: 0 };
        monthlyMap[monthKey].count += timelineMap[date].count;
        monthlyMap[monthKey].totalAcc += timelineMap[date].totalAccuracy;
      });
      finalTimeline = Object.keys(monthlyMap).map(m => ({
        date: m, 
        currentAccuracy: monthlyMap[m].count > 0 ? Math.round(monthlyMap[m].totalAcc / monthlyMap[m].count) : 0,
        prevAccuracy: 0 // Previous logic would need to look back at previous month object
      }));
    } else if (rangeInDays > 14) {
      // Aggregate by Week if range is > 14 days
      let weekAcc = 0, weekCount = 0, weekStart = dateKeys[0];
      dateKeys.forEach((date, i) => {
        weekAcc += timelineMap[date].totalAccuracy;
        weekCount += timelineMap[date].count;
        if ((i + 1) % 7 === 0 || i === dateKeys.length - 1) {
          finalTimeline.push({
            date: `Week of ${weekStart.substring(5)}`,
            currentAccuracy: weekCount > 0 ? Math.round(weekAcc / weekCount) : 0
          });
          weekAcc = 0; weekCount = 0; weekStart = dateKeys[i+1] || date;
        }
      });
    } else {
      // Default: Daily (with 0s)
      finalTimeline = dateKeys.map((date, index) => {
        const curr = timelineMap[date];
        const acc = curr.count > 0 ? Math.round(curr.totalAccuracy / curr.count) : 0;
        // Previous day lookback for the comparison line
        const prevDate = dateKeys[index - 1];
        const prevAcc = prevDate && timelineMap[prevDate].count > 0 
          ? Math.round(timelineMap[prevDate].totalAccuracy / timelineMap[prevDate].count) 
          : 0;

        return { date, currentAccuracy: acc, prevAccuracy: prevAcc };
      });
    }

    return {
      overviewMetrics: {
        totalStudentsRegistered: totalRegisteredStudents, 
        activeStudentsInPeriod: activeStudentsInPeriod.size,
        totalSessionsCompleted: completedCount,
        averageScore: validScoreCount ? Math.round(totalScore / validScoreCount) : 0,
        averageAccuracy: validAccuracyCount ? Math.round(totalAccuracy / validAccuracyCount) : 0,
        totalRounds: totalRounds,
        totalTherapyHours: parseFloat((totalTimeSeconds / 3600).toFixed(2)),
        completionRate: parseFloat(((completedCount / sessions.length) * 100).toFixed(1))
      },
      charts: {
        performanceTimeline: finalTimeline,
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
            avgAccuracy: Math.round(topActivitiesMap[name].totalAccuracy / topActivitiesMap[name].count)
          }))
          .sort((a, b) => b.usageCount - a.usageCount)
          .slice(0, 5)
      }
    };
  },
  
  async generateComparisonMetrics({ baseStudent, compareStudent, startDate, endDate, therapistId }) {
    const studentAData = await this.generateDashboardMetrics({ studentId: baseStudent, startDate, endDate, therapistId });
    const studentBData = await this.generateDashboardMetrics({ studentId: compareStudent, startDate, endDate, therapistId });

    const sharedActivities = [];
    if (studentAData.charts && studentBData.charts) {
        studentAData.charts.topActivities.forEach(actA => {
            const actB = studentBData.charts.topActivities.find(b => b.activityName === actA.activityName);
            if (actB) {
                sharedActivities.push({
                    activityName: actA.activityName,
                    activityType: actA.activityType,
                    baseStudentAccuracy: actA.avgAccuracy,
                    compareStudentAccuracy: actB.avgAccuracy,
                    difference: actA.avgAccuracy - actB.avgAccuracy
                });
            }
        });
    }

    return {
      meta: { comparisonType: compareStudent ? 'Student vs Student' : 'Student vs Global Average' },
      baseStudentMetrics: studentAData.overviewMetrics || null,
      compareStudentMetrics: studentBData.overviewMetrics || null,
      activityHeadToHead: sharedActivities,
      behavioralOverlap: {
          baseStudentRadar: studentAData.charts?.behavioralRadar || [],
          compareStudentRadar: studentBData.charts?.behavioralRadar || []
      }
    };
  },
  
  async generateStudentPasscode(studentId, sessionIds, extraTimeSeconds) {
        if (!studentId) throw new Error('Cannot generate passcode: studentId is undefined');
        const safeStudentId = Number(studentId); 
        const student = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: safeStudentId },
            select: ['id', 'activePasscode', 'passcodeExpiresAt']
        });

        if (!student) throw new Error(`Student with ID ${safeStudentId} not found`);

        const now = new Date();
        let finalPasscode = student.activePasscode;
        let needsNewPin = false;

        if (!student.activePasscode || !student.passcodeExpiresAt) {
            needsNewPin = true;
        } else {
            const expiresDate = new Date(student.passcodeExpiresAt);
            if (expiresDate <= now) needsNewPin = true;
        }

        if (needsNewPin) {
            finalPasscode = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + (4 * 60 * 60 * 1000));
            await strapi.db.query('plugin::users-permissions.user').update({
                where: { id: safeStudentId },
                data: { activePasscode: finalPasscode, passcodeExpiresAt: expiresAt }
            });
        }

        if (!finalPasscode) return null;

        try {
            await strapi.db.query('api::activity-session.activity-session').updateMany({
                where: {
                    student: safeStudentId, 
                    activitySessionStatus: { $in: ['in_progress', 'queued', 'pending'] }
                },
                data: { activitySessionPasscode: finalPasscode }
            });
        } catch (dbError) {}

        return finalPasscode; 
    }
}));