'use strict';

module.exports = {
  // 1. Capture state before update to detect changes in assignment
  async beforeUpdate(event) {
    const { where } = event.params;

    // Use Document Service to find the current appointment state
    const currentAppointment = await strapi.documents('api::appointment.appointment').findOne({
      documentId: where.documentId || where.id,
      populate: ['therapist'],
    });

    // Store the old data for comparison in afterUpdate
    event.state.oldData = currentAppointment;
  },

  // 2. Handle notifications for brand new appointments
  async afterCreate(event) {
    const { result } = event;

    const appointment = await strapi.documents('api::appointment.appointment').findOne({
      documentId: result.documentId,
      populate: ['therapist', 'student', 'service'],
    });

    if (appointment?.therapist) {
      await createAssignmentNotification(strapi, appointment);
    }
  },

  // 3. Handle notifications for re-assignments or late assignments
  async afterUpdate(event) {
    const { result, state } = event;
    const oldData = state.oldData;

    const appointment = await strapi.documents('api::appointment.appointment').findOne({
      documentId: result.documentId,
      populate: ['therapist', 'student', 'service'],
    });

    if (!appointment || !appointment.therapist) return;

    const oldTherapistId = oldData?.therapist?.id;
    const newTherapistId = appointment.therapist.id;

    // Trigger if: no therapist was assigned previously OR the assigned therapist ID changed
    if (!oldTherapistId || oldTherapistId !== newTherapistId) {
      await createAssignmentNotification(strapi, appointment);
    }
  },
};

/**
 * Helper to generate the notification
 * Uses numeric ID for User and documentId for Appointment
 */
async function createAssignmentNotification(strapi, appointment) {
  // Use numeric .id for the User (Therapist)
  const therapistId = appointment.therapist?.id;
  // Use string .documentId for the Appointment link
  const appointmentDocId = appointment.documentId;

  if (!therapistId || !appointmentDocId) return;

  const studentName = appointment.student?.firstName || 'a learner';
  const serviceName = appointment.service?.name || 'Session';
  
  let startTime = '';
  if (appointment.startAt) {
    startTime = new Date(appointment.startAt).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
  }

  try {
    await strapi.documents('api::notification.notification').create({
        data: {
          title: 'New Appointment Assigned 📅',
          message: `You have been assigned to a ${serviceName} with ${studentName}${startTime ? ` scheduled for ${startTime}` : ''}.`,
          type: 'schedule',
          priority: 'info',
          isRead: false,
          
          // --- LINKING ---
          user: therapistId,          // Student/Therapist are Users -> use ID
          appointment: appointmentDocId, // Appointment is a Document -> use documentId
          
          metadata: {
            appointmentId: appointmentDocId,
            studentId: appointment.student?.id
          },
          status: 'published' // Ensure it's live immediately in Strapi 5
        },
      });
    
    strapi.log.info(`[Notification] Assignment linked for Therapist ID: ${therapistId}`);
  } catch (error) {
    strapi.log.error(`[Notification Error] ${error.message}`);
  }
}