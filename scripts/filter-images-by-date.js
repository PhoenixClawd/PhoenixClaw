/**
 * Filter images by date from session logs
 * Fixes: Images from previous days being included in wrong journal
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Get the UTC offset in hours for a given timezone at a specific date
 * @param {string} timezone - Timezone identifier (e.g., 'Asia/Shanghai', 'America/Los_Angeles')
 * @param {Date} [date] - Date to compute offset for (default: now)
 * @returns {number} Offset in hours (positive = ahead of UTC, negative = behind UTC)
 */
function getTimezoneOffset(timezone, date = new Date()) {
  const utcFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const utcParts = utcFormatter.formatToParts(date);
  const tzParts = tzFormatter.formatToParts(date);

  const getPart = (parts, type) => parseInt(parts.find(p => p.type === type).value);

  const utcDate = Date.UTC(
    getPart(utcParts, 'year'),
    getPart(utcParts, 'month') - 1,
    getPart(utcParts, 'day'),
    getPart(utcParts, 'hour'),
    getPart(utcParts, 'minute'),
    getPart(utcParts, 'second')
  );

  const tzDate = Date.UTC(
    getPart(tzParts, 'year'),
    getPart(tzParts, 'month') - 1,
    getPart(tzParts, 'day'),
    getPart(tzParts, 'hour'),
    getPart(tzParts, 'minute'),
    getPart(tzParts, 'second')
  );

  // Offset = (UTC - Local) in hours
  // For UTC+8 (Asia/Shanghai), this returns -8
  // For UTC-8 (America/Los_Angeles), this returns +8
  return (utcDate - tzDate) / (1000 * 60 * 60);
}

/**
 * Get day bounds in the configured timezone
 * @param {string} targetDate - ISO date string (YYYY-MM-DD)
 * @param {string} timezone - Timezone identifier (default: Asia/Shanghai)
 * @returns {{start: Date, end: Date}} Start and end of day in target timezone
 */
function getDayBounds(targetDate, timezone = 'Asia/Shanghai') {
  // Parse the target date
  const [year, month, day] = targetDate.split('-').map(Number);

  // Use Intl.DateTimeFormat to get exact UTC timestamps for local midnight and end-of-day
  // This handles DST transitions and fractional offsets correctly

  // Get the UTC timestamp for local midnight (00:00:00)
  const getLocalMidnightUTC = () => {
    // Start with target date at UTC midnight, then adjust
    let utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });

    // Binary search to find the UTC time that maps to local midnight
    // We need to find utcTime such that format(utcTime) shows the target date at 00:00:00
    let low = utcGuess - 24 * 60 * 60 * 1000; // 1 day before
    let high = utcGuess + 24 * 60 * 60 * 1000; // 1 day after

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const parts = formatter.formatToParts(new Date(mid));
      const getPart = (t) => parts.find(p => p.type === t).value;
      const localYear = parseInt(getPart('year'));
      const localMonth = parseInt(getPart('month'));
      const localDay = parseInt(getPart('day'));
      const localHour = parseInt(getPart('hour'));
      const localMinute = parseInt(getPart('minute'));
      const localSecond = parseInt(getPart('second'));

      const localTime = localYear * 10000000000 + localMonth * 100000000 + localDay * 1000000 +
                       localHour * 10000 + localMinute * 100 + localSecond;
      const targetTime = year * 10000000000 + month * 100000000 + day * 1000000;

      if (localTime < targetTime) {
        low = mid + 1;
      } else if (localTime > targetTime) {
        high = mid - 1;
      } else {
        // Found local midnight, return this UTC timestamp
        return mid;
      }
    }
    // Fallback: use approximate offset
    return utcGuess;
  };

  // Get the UTC timestamp for local end-of-day (23:59:59.999)
  const getLocalEndOfDayUTC = () => {
    const midnight = getLocalMidnightUTC();
    // Add 24 hours minus 1ms to get end of day
    return midnight + 24 * 60 * 60 * 1000 - 1;
  };

  const startMs = getLocalMidnightUTC();
  const endMs = getLocalEndOfDayUTC();

  return {
    start: new Date(startMs),
    end: new Date(endMs)
  };
}

/**
 * Get today's date in the configured timezone
 * @param {string} timezone - Timezone identifier (default: Asia/Shanghai)
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getLocalDate(timezone = 'Asia/Shanghai') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(new Date());
  const getPart = (type) => parts.find(p => p.type === type).value;
  
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

/**
 * Extract images from session logs for a specific date
 * @param {string[]} sessionDirs - Array of session directories to scan
 * @param {string} targetDate - ISO date string (YYYY-MM-DD)
 * @param {string} timezone - Timezone identifier
 * @returns {Promise<Array>} Array of image objects
 */
async function extractImagesFromSessionLogs(sessionDirs, targetDate, timezone) {
  const { start, end } = getDayBounds(targetDate, timezone);
  const startEpoch = Math.floor(start.getTime() / 1000);
  const endEpoch = Math.floor(end.getTime() / 1000);
  
  const images = [];
  const seenPaths = new Set(); // Deduplication
  
  // Ensure sessionDirs is an array
  const dirs = Array.isArray(sessionDirs) ? sessionDirs : [sessionDirs];
  
  for (const sessionDir of dirs) {
    if (!fs.existsSync(sessionDir)) continue;
    
    // Find all session log files
    const findCmd = `find "${sessionDir}" -name "*.jsonl" -print0 2>/dev/null`;
    
    try {
      const files = execSync(findCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      const fileList = files.split('\0').filter(f => f.trim());
      
      for (const file of fileList) {
        if (!fs.existsSync(file)) continue;
        
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            
            // Check if this is an image message
            if (msg.type !== 'image') continue;
            
            // Get timestamp from various possible fields
            const ts = msg.timestamp || msg.created_at || msg.date;
            if (!ts) continue;
            
            // Parse timestamp
            let epoch;
            if (typeof ts === 'number') {
              epoch = ts;
            } else {
              epoch = Math.floor(new Date(ts).getTime() / 1000);
            }
            
            // Check if within target date range
            if (epoch >= startEpoch && epoch <= endEpoch) {
              const imgPath = msg.file_path || msg.url || msg.path;
              
              // Deduplication
              if (seenPaths.has(imgPath)) continue;
              seenPaths.add(imgPath);
              
              images.push({
                path: imgPath,
                timestamp: ts,
                epoch: epoch
              });
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }
    } catch (e) {
      console.error(`Error reading session logs from ${sessionDir}:`, e.message);
    }
  }
  
  return images;
}

/**
 * Copy filtered images to journal assets directory
 * @param {Array} images - Array of image objects
 * @param {string} targetDate - ISO date string
 * @param {string} journalPath - Base journal path
 * @returns {Promise<Array>} Array of copied image info
 */
async function copyImagesToAssets(images, targetDate, journalPath) {
  const assetsDir = path.join(journalPath, 'assets', targetDate);
  
  // Create assets directory if not exists
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  
  const copied = [];
  
  for (const img of images) {
    if (!img.path || !fs.existsSync(img.path)) continue;
    
    const filename = path.basename(img.path);
    const destPath = path.join(assetsDir, filename);
    
    try {
      fs.copyFileSync(img.path, destPath);
      copied.push({
        original: img.path,
        dest: destPath,
        filename: filename
      });
    } catch (e) {
      console.error(`Failed to copy ${filename}:`, e.message);
    }
  }
  
  return copied;
}

module.exports = {
  getTimezoneOffset,
  getDayBounds,
  getLocalDate,
  extractImagesFromSessionLogs,
  copyImagesToAssets
};

// CLI usage
if (require.main === module) {
  const timezone = process.env.TZ || 'Asia/Shanghai';
  const targetDate = process.argv[2] || getLocalDate(timezone);
  const journalPath = process.argv[3] || `${process.env.HOME}/PhoenixClaw/Journal`;
  
  // Scan all known session roots as per project workflow
  const sessionDirs = [
    `${process.env.HOME}/.openclaw/sessions`,
    `${process.env.HOME}/.openclaw/agents`,
    `${process.env.HOME}/.openclaw/cron/runs`,
    `${process.env.HOME}/.agent/sessions`
  ].filter(dir => fs.existsSync(dir));
  
  console.log(`Filtering images for date: ${targetDate} (${timezone})`);
  console.log(`Scanning ${sessionDirs.length} session directories...`);
  
  extractImagesFromSessionLogs(sessionDirs, targetDate, timezone)
    .then(images => {
      console.log(`Found ${images.length} images for ${targetDate}`);
      return copyImagesToAssets(images, targetDate, journalPath);
    })
    .then(copied => {
      console.log(`Copied ${copied.length} images to assets`);
      copied.forEach(img => console.log(`  - ${img.filename}`));
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}
