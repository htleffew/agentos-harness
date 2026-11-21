// Prompt order within the two structured-request sections (guidance and returned fields).
export const MODULE_PROMPTS = {
    style:['groundedRealism','heightenedRealism'], preflight:['sceneSolo','sceneEnsemble','sceneUnknown','sceneOpening','sceneContinue','checkPhysical','checkSocial','checkCraft','checkContinuity'],
    colors:['speakerGuidance'], emotions:['emotionSensitivity','checkEmotion','structuredEmotions'],
    state:['timingUpdate','structuredFacts','structuredPortrayal'], plots:['lockedPayoff','checkPlot','structuredOutcomes','structuredSchedule','optionalOpportunity'],
    knowledge:['checkKnowledge','structuredKnowledge'], relationships:['structuredRelationships'],
    worldEvents:['autonomousEvent'], dice:['resolvedActionGuidance'], roastFeedback:['roastFeedback'], roast:['structuredRoast'],
};
export function moduleOrder(saved) {
    const known = Object.keys(MODULE_PROMPTS);
    return [...new Set([...(Array.isArray(saved) ? saved : []),...known])].filter(key=>Object.hasOwn(MODULE_PROMPTS,key));
}
export function orderedSections(parts, saved) {
    if (!saved?.length) return parts.map(([,text])=>text).filter(Boolean);
    const order = moduleOrder(saved);
    return [...parts].sort(([a],[b])=>order.indexOf(a)-order.indexOf(b)).map(([,text])=>text).filter(Boolean);
}
