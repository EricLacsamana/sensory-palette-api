import { parseFile } from 'music-metadata';
import path from 'path';
import fs from 'fs';
import ytdl from 'ytdl-core';

export default {
  async beforeCreate(event) {
    await calculateMediaDuration(event);
  },

  async beforeUpdate(event) {
    await calculateMediaDuration(event);
  },
};

async function calculateMediaDuration(event) {
  const { data } = event.params;

  // --- LOGIC A: YOUTUBE DETECTION (via activityUrl) ---
  if (data.activityType === 'video' && data.activityUrl && isYouTube(data.activityUrl)) {
    try {
      strapi.log.info(`Fetching YouTube metadata for: ${data.activityUrl}`);
      const info = await ytdl.getBasicInfo(data.activityUrl);
      const seconds = parseInt(info.videoDetails.lengthSeconds);
      
      if (seconds > 0) {
        data.durationMinutes = Math.ceil(seconds / 60);
        strapi.log.info(`YouTube Duration Found: ${data.durationMinutes} minutes`);
      }
    } catch (error) {
      strapi.log.error('YouTube Metadata Fetch Failed:', error.message);
    }
  }

  // --- LOGIC B: UPLOADED FILE DETECTION (via activityFile) ---
  if (['audio', 'video'].includes(data.activityType) && data.activityFile) {
    try {
      let fileIds = [];
      
      // Strapi v5 Relationship Parsing
      if (Array.isArray(data.activityFile)) {
        fileIds = data.activityFile.map(f => typeof f === 'object' ? f.id : f);
      } else if (data.activityFile?.connect) {
        fileIds = data.activityFile.connect.map(c => c.documentId || c.id);
      }

      if (fileIds.length > 0) {
        // Updated to Strapi v5 format
        const files = await strapi.documents('plugin::upload.file').findMany({
          filters: { documentId: { $in: fileIds } },
        });

        let totalSeconds = 0;
        for (const file of files) {
          // Skip if not media
          if (!file.mime.startsWith('audio/') && !file.mime.startsWith('video/')) continue;
          
          // Check if local file
          const isLocal = !file.url.startsWith('http');
          if (isLocal) {
            const filePath = path.join(strapi.dirs.static.public, file.url);
            if (fs.existsSync(filePath)) {
              const metadata = await parseFile(filePath);
              if (metadata.format.duration) {
                totalSeconds += metadata.format.duration;
              }
            }
          }
        }

        if (totalSeconds > 0) {
          data.durationMinutes = Math.ceil(totalSeconds / 60);
          strapi.log.info(`File Duration Calculated: ${data.durationMinutes} minutes`);
        }
      }
    } catch (error) {
      strapi.log.error('File Metadata Parsing Failed:', error);
    }
  }
}

// Helper to check for YouTube URLs
function isYouTube(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/.test(url);
}