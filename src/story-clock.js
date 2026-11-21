const DAY = 1440;
const DAY_MS = 86400000;

export const validStoryMinute = value => Number.isSafeInteger(value) && value >= 0;
export const validElapsed = value => validStoryMinute(value) && value <= 5256000;

function clockTime(value) {
    const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]), period = match[3]?.toUpperCase();
    if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return null;
    return { minutes:(period ? hour % 12 + (period==='PM' ? 12 : 0) : hour)*60+minute, twelve:!!period };
}

function formatTime(minutes, twelve) {
    const hour = Math.floor(minutes/60);
    const minute = String(minutes%60).padStart(2,'0');
    return twelve ? `${hour%12 || 12}:${minute} ${hour<12 ? 'AM' : 'PM'}` : `${String(hour).padStart(2,'0')}:${minute}`;
}

function dayNumber(value) {
    const date = String(value || '').trim();
    const ordinal = /^Day\s+(\d{1,9})$/i.exec(date);
    if (ordinal) return { format:'ordinal', day:Number(ordinal[1]) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const stamp = Date.parse(date+'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().startsWith(date+'T')
        ? { format:'iso',day:stamp/DAY_MS } : null;
}

function nextDate(date, days) {
    if (!days) return date;
    const current = dayNumber(date);
    if (!current) return '';
    const day = current.day+days;
    if (current.format==='ordinal') return day < 1e9 ? `Day ${day}` : '';
    const shifted = new Date(day*DAY_MS);
    return Number.isFinite(shifted.valueOf()) && shifted.getUTCFullYear() <= 9999
        ? shifted.toISOString().slice(0,10) : '';
}

function datedInterval(before, next, start, end) {
    if (!start || !end || !before.date || !next.date) return undefined;
    if (before.date===next.date) return end.minutes-start.minutes;
    const from = dayNumber(before.date), to = dayNumber(next.date);
    if (from && to?.format===from.format) return (to.day-from.day)*DAY+end.minutes-start.minutes;
    return undefined;
}

/** Advance the relative story clock and the displayed scene from one accepted update. */
export function advanceStoryClock(previous = {}, update = {}, { clock, minutes, elapsed } = {}) {
    const scene = { ...previous,...update };
    const issue = [];
    const start = clockTime(previous.time || previous.when);
    const end = clockTime(update.time);
    const measured = datedInterval(previous,update,start,end);
    const known = validStoryMinute(clock);
    let duration = validElapsed(elapsed) ? elapsed : undefined;
    if (known && validStoryMinute(minutes)) {
        if (minutes < clock) issue.push('Story minutes cannot move backwards.');
        else if (minutes>clock || !duration) duration=minutes-clock;
    }
    if (measured < 0) {
        issue.push('The submitted date and time moved backwards. Kept the established timeline.');
        scene.date=previous.date;
        scene.time=previous.time;
    } else if (measured !== undefined && (measured>0 || !duration)) {
        if (duration !== undefined && measured!==duration) {
            issue.push('The stated elapsed time disagreed with the dated scene. Used the dated scene for elapsed time.');
        }
        duration=measured;
    }
    if (duration===undefined && previous.date && start && end && !update.date && end.minutes>=start.minutes) {
        duration=end.minutes-start.minutes;
    }
    if (duration===undefined && previous.date && update.date && update.date!==previous.date && !update.time) {
        delete scene.time;
        if (!update.when) delete scene.when;
    }
    if (update.time && update.time!==previous.time && !update.when) delete scene.when;
    if (update.when!==undefined && update.time===undefined) delete scene.time;
    if (duration===undefined && start && end && end.minutes<start.minutes && !update.date) {
        issue.push('An earlier clock time needs a date or elapsed minutes to establish when it occurs.');
        scene.time=previous.time;
    }
    if (duration>0) {
        if (!update.when && (start || duration>=60)) delete scene.when;
        if (start) {
            const local = start.minutes + duration%DAY;
            const days = Math.floor(duration/DAY)+Math.floor(local/DAY);
            const endMinute = local%DAY;
            if (end && end.minutes!==endMinute && !(measured>0)) {
                issue.push('The submitted clock time disagreed with the elapsed minutes. Used the elapsed minutes for the clock time.');
            }
            scene.time=formatTime(endMinute,(end || start).twelve);
            if (days && (!Object.hasOwn(update,'date') || update.date===previous.date || measured<0)) {
                const date = nextDate(previous.date,days);
                scene.date=date;
                if (!date && previous.date) scene.lastKnownDate=previous.date;
            }
        } else {
            if (duration>=60 && !update.time) delete scene.time;
            if (duration>=DAY && !Object.hasOwn(update,'date')) {
                const date = duration%DAY===0 ? nextDate(previous.date,duration/DAY) : '';
                scene.date=date;
                if (!date && previous.date) scene.lastKnownDate=previous.date;
            }
        }
    }
    if (scene.date) delete scene.lastKnownDate;
    const candidate = known ? clock+(duration ?? 0)
        : validStoryMinute(minutes) ? minutes : duration ?? (end || start ? 0 : undefined);
    const storyMinute = validStoryMinute(candidate) ? candidate : known ? clock : undefined;
    return { scene,minutes:storyMinute,issues:issue };
}
