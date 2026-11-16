/** @param {{exam?: import('../../../shared/v2/state.js').ExamTimes}} snapshot
 * @returns {import('../types/data.js').RoundScope} */
export const scopeOf = (snapshot) => (snapshot.exam ? 'exam' : 'practice');
