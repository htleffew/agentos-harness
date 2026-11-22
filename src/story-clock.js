const DAY = 1440;
const DAY_MS = 86400000;
const NUMBERED_YEAR = 2001; // Yearless numbered calendars use a conventional non-leap year.
const DAYS_IN_NUMBERED_YEAR = 365;
const NUMBERED_FIRST_DAY = Date.UTC(NUMBERED_YEAR,0,1)/DAY_MS;
const WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const weekdayPrefix = new RegExp(`^(${WEEK.join('|')})(?:,?\\s+|,?$)`,'i');
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const STORY_SEASONS = {
    Winter:['Deepwinter','Snowfall','Wolfsblood'],
    Spring:['Snowmelt','Seedmoon','Blossomtide'],
    Summer:['Highsun','Solstice','Reaping'],
    Autumn:['Harvest','Leafturn','Frostfall'],
};
const STORY_MONTHS = Object.values(STORY_SEASONS).flat();
const STORY_MONTH_DAYS = 30;
const STORY_YEAR_DAYS = STORY_MONTHS.length * STORY_MONTH_DAYS;
const storyMonth = `(${STORY_MONTHS.join('|')})`;
const storyDay = '(\\d{1,2})(?:st|nd|rd|th)?';
const storyDatePattern = new RegExp(
    `^(?:${storyMonth}\\s+(?:day\\s+)?${storyDay}|(?:day\\s+)?${storyDay}\\s+(?:of\\s+)?${storyMonth})(?:\\s*,\\s*|\\s+)(?:year\\s+)?(\\d{1,4})$`,'i');
const storyCalendarGuidance = 'Use the story calendar with 30 days in each month. Month order by season is ' +
    Object.entries(STORY_SEASONS).map(([season,months])=>`${season} (${months.join(', ')})`).join(', ') +
    '. Advance the year after Frostfall 30.';

export const validStoryMinute = value => Number.isSafeInteger(value) && value >= 0;
export const validElapsed = value => validStoryMinute(value) && value <= 5256000;

function clockTime(value) {
    const match = /^(\d{1,2}):(\d{2})(?:\s*([AP])\.?M\.?)?$/i.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]), period = match[3]?.toUpperCase();
    if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return null;
    return { minutes:(period ? hour % 12 + (period==='P' ? 12 : 0) : hour)*60+minute, twelve:!!period };
}

function formatTime(minutes, twelve) {
    const hour = Math.floor(minutes/60);
    const minute = String(minutes%60).padStart(2,'0');
    return twelve ? `${hour%12 || 12}:${minute} ${hour<12 ? 'AM' : 'PM'}` : `${String(hour).padStart(2,'0')}:${minute}`;
}

function weekdayIndex(value) {
    const name = value.match(weekdayPrefix)?.[1].toLowerCase();
    return WEEK.findIndex(day=>day.toLowerCase()===name);
}

export function weekdayAtOffset(date, days) {
    const weekday = weekdayIndex(String(date || '').trim());
    return weekday>=0 && Number.isSafeInteger(days) && days>=0 ? WEEK[(weekday+(days%7))%7] : '';
}

export function parseFantasyDate(value) {
    const match = storyDatePattern.exec(String(value ?? '').trim().replace(weekdayPrefix,''));
    if (!match) return null;
    const monthName = (match[1] || match[4]).toLowerCase();
    const month = STORY_MONTHS.findIndex(name=>name.toLowerCase()===monthName);
    const day = Number(match[2] || match[3]), year = Number(match[5]);
    return { month,day,year,valid:day>=1 && day<=STORY_MONTH_DAYS && year>=1 };
}

export function fantasyDateError(value) {
    const date=parseFantasyDate(value);
    if (!date || date.valid) return '';
    return 'Use a day from 1 to 30 and a positive year for this story calendar.';
}

export function fantasyCalendarGuidance(date) {
    return parseFantasyDate(date)?.valid ? storyCalendarGuidance : '';
}

function dayNumber(value) {
    const original = String(value || '').trim();
    const weekday = weekdayIndex(original);
    const date = original.replace(weekdayPrefix,'');
    const fantasy = parseFantasyDate(date);
    if (fantasy) return fantasy.valid ? {format:'fantasy',weekday,
        day:(fantasy.year-1)*STORY_YEAR_DAYS+fantasy.month*STORY_MONTH_DAYS+fantasy.day-1} : null;
    const ordinal = /^Day\s+(\d{1,9})$/i.exec(date);
    if (ordinal) return { format:'ordinal', day:Number(ordinal[1]),weekday };
    const numbered = /^Month\s+(\d{1,2})\s*,\s*Day\s+(\d{1,2})$/i.exec(date);
    if (numbered) {
        const month=Number(numbered[1]), day=Number(numbered[2]);
        const stamp=Date.UTC(NUMBERED_YEAR,month-1,day);
        const checked=new Date(stamp);
        return month===checked.getUTCMonth()+1 && day===checked.getUTCDate()
            ? {format:'numbered',day:stamp/DAY_MS,month,weekday} : null;
    }
    const written = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(date);
    const month = written ? MONTHS.findIndex(name=>name.toLowerCase()===written[1].toLowerCase()) : -1;
    const iso = month>=0 ? `${written[3]}-${String(month+1).padStart(2,'0')}-${written[2].padStart(2,'0')}` : date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const stamp = Date.parse(iso+'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().startsWith(iso+'T')
        ? { format:'calendar',day:stamp/DAY_MS,weekday,written:month>=0 } : null;
}

function nextDate(date, days) {
    if (!days) return date;
    const current = dayNumber(date);
    if (!current) return '';
    const day = current.day+days;
    if (current.format==='ordinal') {
        const prefix = current.weekday>=0 ? `${WEEK[(current.weekday+days)%7]}, ` : '';
        return day < 1e9 ? `${prefix}Day ${day}` : '';
    }
    if (current.format==='numbered') {
        const offset=(current.day-NUMBERED_FIRST_DAY+(days%DAYS_IN_NUMBERED_YEAR))%DAYS_IN_NUMBERED_YEAR;
        const numbered=new Date((NUMBERED_FIRST_DAY+offset)*DAY_MS);
        const weekday=weekdayAtOffset(date,days);
        return `${weekday ? `${weekday}, ` : ''}Month ${numbered.getUTCMonth()+1}, Day ${numbered.getUTCDate()}`;
    }
    if (current.format==='fantasy') {
        const year=Math.floor(day/STORY_YEAR_DAYS)+1;
        if (year>9999) return '';
        const month=Math.floor((day%STORY_YEAR_DAYS)/STORY_MONTH_DAYS);
        const weekday=weekdayAtOffset(date,days);
        return `${weekday ? `${weekday}, ` : ''}${STORY_MONTHS[month]} ${day%STORY_MONTH_DAYS+1}, ${year}`;
    }
    const shifted = new Date(day*DAY_MS);
    if (!Number.isFinite(shifted.valueOf()) || shifted.getUTCFullYear()>9999) return '';
    const prefix = current.weekday>=0 ? `${WEEK[shifted.getUTCDay()]}, ` : '';
    return prefix + (current.written
        ? `${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}, ${shifted.getUTCFullYear()}`
        : shifted.toISOString().slice(0,10));
}

function dateDistance(before, next) {
    if (!before || !next) return null;
    if (before===next) return {days:0};
    const from=dayNumber(before), to=dayNumber(next);
    if (!from || to?.format!==from.format) return null;
    const turnOfYear=from.format==='numbered' && from.month===12 && to.month===1;
    return {days:to.day-from.day+(turnOfYear ? DAYS_IN_NUMBERED_YEAR : 0),from};
}

/** Fill dates in older saved scenes when the original rollover only kept an offset. */
export function recoverSceneDate(scene) {
    const days=scene.daysAfterKnownDate;
    if (scene.date || !scene.lastKnownDate || !Number.isSafeInteger(days) || days<=0) return scene;
    const date=nextDate(scene.lastKnownDate,days);
    if (!date) return scene;
    const {lastKnownDate,daysAfterKnownDate,...rest}=scene;
    return {...rest,date};
}

function rollDate(scene,previous,days) {
    scene.date=nextDate(previous.date,days);
    const known=previous.date || previous.lastKnownDate;
    if (scene.date || !known) return;
    scene.lastKnownDate=known;
    if (previous.date || Number.isSafeInteger(previous.daysAfterKnownDate)) {
        scene.daysAfterKnownDate=(previous.date ? 0 : previous.daysAfterKnownDate)+days;
    }
}

/** Advance the relative story clock and the displayed scene from one accepted update. */
export function advanceStoryClock(previous = {}, update = {}, { clock, minutes, elapsed } = {}) {
    previous=recoverSceneDate(previous);
    const anchor=dayNumber(previous.date);
    const issue = [];
    const invalidDate=fantasyDateError(update.date);
    if (invalidDate) issue.push(invalidDate);
    const tracksNamedDate=anchor?.format==='fantasy' || (anchor?.format==='numbered' && anchor.weekday>=0);
    if (invalidDate || (tracksNamedDate && WEEK.some(day=>day.toLowerCase()===String(update.date || '').trim().toLowerCase()))) {
        // A weekday alone adds no information to an established calendar date.
        const {date,...rest}=update;
        update=rest;
    }
    const scene = { ...previous,...update };
    const start = clockTime(previous.time || previous.when);
    const end = clockTime(update.time);
    const distance=dateDistance(previous.date,update.date);
    const measured=start && end && distance ? distance.days*DAY+end.minutes-start.minutes : undefined;
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
    if (tracksNamedDate && anchor.weekday>=0 && distance?.from && distance.days>=0 && !(measured<0)) {
        scene.date=nextDate(previous.date,distance.days);
    }
    if (duration===undefined && start && end && !update.date && end.minutes>=start.minutes) {
        duration=end.minutes-start.minutes;
    }
    if (duration===undefined && previous.date && update.date && scene.date!==previous.date && !update.time) {
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
            if (days && (!Object.hasOwn(update,'date') || update.date===previous.date ||
                (anchor?.format==='fantasy' && distance?.days===0) || measured<0)) {
                rollDate(scene,previous,days);
            }
        } else {
            if (duration>=60 && !update.time) delete scene.time;
            if (duration>=DAY && !Object.hasOwn(update,'date')) {
                const days=Math.floor(duration/DAY);
                rollDate(scene,previous,days);
                if (duration%DAY) {
                    scene.date='';
                    scene.lastKnownDate=previous.date || previous.lastKnownDate;
                    delete scene.daysAfterKnownDate;
                }
            }
        }
    }
    if (scene.date) {
        delete scene.lastKnownDate;
        delete scene.daysAfterKnownDate;
    }
    const candidate = known ? clock+(duration ?? 0)
        : validStoryMinute(minutes) ? minutes : duration ?? (end || start ? 0 : undefined);
    const storyMinute = validStoryMinute(candidate) ? candidate : known ? clock : undefined;
    return { scene,minutes:storyMinute,issues:issue };
}
