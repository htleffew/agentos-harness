// Undercurrent 2: build every slot value from content + settings (+ derived state + provider lines for turn slots).
// Pure. Static values are memoized by a signature of everything they may depend on, so they are byte-stable across
// turns and nearly free to rebuild.

import { SLOTS, STATIC_SLOTS, TURN_SLOT_DEFS, BLANK_BY_MODE, requiredPlaceholders } from './registry.js';
import { computePlaceholders } from './fill.js';
import { buildEnvelopeInstructions } from '../envelope/instructions.js';
import { reasoningMode } from './models.js';
import { stableStringify } from '../core/util.js';

/**
 * Normalize a slot-build context.
 * @param {object} o
 * @param {object} o.content effective content
 * @param {object} o.settings effective settings
 * @param {object} o.roles role → key map
 * @param {{name?:string, description?:string}} [o.persona]
 * @param {{id?:string, family?:string}} [o.model]
 * @param {Record<string,string[]>} [o.staticExtra] provider static text ({uc_prose:[...], 'uc.banlist':[...]})
 * @param {Record<string,{text,priority}[]>} [o.lines] provider turn lines
 * @param {'normal'|'impersonate'|'quiet'|'off'} [o.mode]
 * @param {string} [o.impersonationText]
 * @param {object[]} [o.registry] envelope block registry
 * @param {string|number} [o.contentKey] changes whenever content (or prompt overrides) change
 */
export function makeSlotContext(o) {
    const settings = o.settings || {};
    const roles = o.roles || {};
    const content = o.content || {};
    const model = { id: String(o.model?.id ?? ''), family: String(o.model?.family ?? '') };
    const staticExtra = {};
    const placeholderExtra = {};
    for (const [k, v] of Object.entries(o.staticExtra || {})) {
        if (k.startsWith('uc.')) placeholderExtra[k.slice(3)] = v;
        else staticExtra[k] = v;
    }
    return {
        content,
        settings,
        roles,
        persona: o.persona || {},
        card: o.card || {},
        model,
        staticExtra,
        placeholderExtra,
        lines: o.lines || {},
        mode: o.mode || 'normal',
        impersonationText: o.impersonationText || '',
        registry: o.registry || null,
        contentKey: o.contentKey ?? '',
        reasoning: reasoningMode(settings[roles.reasoning || 'writing.reasoning'], model.family, model.id, content.models),
    };
}

export function createSlotBuilder() {
    let memo = { sig: null, values: null };

    function staticSignature(ctx) {
        return stableStringify({
            s: ctx.settings,
            r: ctx.roles,
            f: ctx.model.family,
            c: ctx.contentKey,
            x: ctx.staticExtra,
            y: ctx.placeholderExtra,
        });
    }

    /** {slotId: text} for the static zone (memoized). */
    function buildStatic(ctx) {
        const sig = staticSignature(ctx);
        if (memo.sig === sig) return memo.values;
        const placeholders = computePlaceholders({
            content: ctx.content, settings: ctx.settings, roles: ctx.roles, family: ctx.model.family, extra: ctx.placeholderExtra,
        });
        const c = { ...ctx, placeholders };
        const values = {};
        for (const s of STATIC_SLOTS) {
            const req = requiredPlaceholders(c, s);
            if (req.length && !req.some(n => String(placeholders[n] ?? '').trim())) { values[s.id] = ''; continue; }
            try { values[s.id] = String(s.build(c) ?? '').trim(); } catch { values[s.id] = ''; }
        }
        memo = { sig, values: Object.freeze(values), placeholders };
        return memo.values;
    }

    /** {slotId: text} for the turn zone. */
    function buildTurn(ctx) {
        const blank = new Set(BLANK_BY_MODE[ctx.mode] || []);
        buildStatic(ctx); // keeps memo.placeholders in step with this ctx
        const placeholders = memo.placeholders;
        const c = {
            ...ctx,
            placeholders,
            envelopeText: blank.has('uc_envelope') ? '' : buildEnvelopeInstructions(ctx.content, ctx.settings, ctx.registry),
        };
        const values = {};
        for (const s of TURN_SLOT_DEFS) {
            if (blank.has(s.id)) { values[s.id] = ''; continue; }
            try { values[s.id] = String(s.build(c) ?? '').trim(); } catch { values[s.id] = ''; }
        }
        return values;
    }

    /** Everything: {byId, byTrigger}. */
    function build(ctx) {
        const st = buildStatic(ctx);
        const tu = buildTurn(ctx);
        const byId = { ...st, ...tu };
        const byTrigger = {};
        for (const s of SLOTS) byTrigger[s.trigger] = byId[s.id] ?? '';
        return { byId, byTrigger, static: st, turn: tu };
    }

    return { buildStatic, buildTurn, build, reset: () => { memo = { sig: null, values: null }; } };
}
