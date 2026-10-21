// Undercurrent 2: envelope instruction text for [[uc_envelope]] (BUILD_SPEC §3.1). Pure.
// text = content.slots.uc_envelope[full|compact], a blank line, the <UC> skeleton (open, the enabled blocks' templates
// in registry order, close), then one "- Tag: rule" line per enabled block that has a rule. Same layout as
// content.js contentEnvelope(). Disabled blocks (settings gates) are left out entirely.

import { blockRegistry, enabledBlocks } from './registry.js';

function wrapTemplate(block) {
    const t = String(block.template ?? '').trim();
    const open = new RegExp(`^<\\s*${block.tag}\\b`, 'i');
    if (t && open.test(t)) return t;
    const attr = block.attrs?.includes('name') ? ' name="Name"' : '';
    return t ? `<${block.tag}${attr}>\n${t}\n</${block.tag}>` : `<${block.tag}${attr}>\n…\n</${block.tag}>`;
}

/**
 * @param {object} content effective content
 * @param {object} settings effective settings (envelope.compact + block gates)
 * @param {object[]} [registry] defaults to blockRegistry(content)
 * @returns {string} '' when no block is enabled
 */
export function buildEnvelopeInstructions(content, settings, registry = null) {
    const reg = registry || blockRegistry(content);
    const blocks = enabledBlocks(reg, settings);
    if (!blocks.length) return '';
    const compact = settings?.['envelope.compact'] !== false;
    const headers = content?.slots?.uc_envelope || {};
    const header = String((compact ? headers.compact : headers.full) ?? headers.full ?? headers.compact ?? '').trim();
    // The header mentions <UC> in prose only; the skeleton always gets its own wrapper lines.
    const open = String(headers.open ?? '').trim() || '<UC>';
    const close = String(headers.close ?? '').trim() || '</UC>';
    const rules = blocks.filter(b => String(b.rule ?? '').trim()).map(b => `- ${b.tag}: ${String(b.rule).trim()}`);
    return [...(header ? [header, ''] : []), open, ...blocks.map(wrapTemplate), close, ...rules].join('\n');
}
