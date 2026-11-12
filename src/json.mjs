// Reading the JSON a model replies with: the object is found among fences, stray prose and reasoning
// blocks, and the small slips models make in otherwise sound JSON are mended without touching what they wrote.

const WS = /\s/;
const nextAt = (text, i) => {
  while (i < text.length && WS.test(text[i])) i++;
  return i;
};

/**
 * Mend the slips a model makes in otherwise sound JSON, without touching what it wrote:
 *   a quotation mark inside a string that was not escaped   "text": "他说"本体"是关键"
 *   a line break or tab typed inside a string
 *   a comma left out between two values, or left on after the last one
 * A quotation mark ends its string only when what follows could follow a string: a colon, a comma that
 * leads to another value, a closing bracket, or the end. Anything else is part of the text.
 */
export function repairJson(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inString) {
      if (c === ',' && /[}\]]/.test(text[nextAt(text, i + 1)] || '')) continue; // a comma after the last value
      out += c;
      if (c === '"') inString = true;
      else if ((c === '}' || c === ']') && /["{[]/.test(text[nextAt(text, i + 1)] || '')) out += ','; // } { with no comma
      continue;
    }
    if (c === '\\') {
      out += c + (text[++i] ?? '');
    } else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c !== '"') out += c;
    else {
      const j = nextAt(text, i + 1);
      const after = text[j];
      const afterComma = after === ',' ? text.slice(nextAt(text, j + 1), nextAt(text, j + 1) + 5) : '';
      const closes = after === undefined || after === ':' || after === '}' || after === ']' || (after === ',' && /^(["{[\d}\]-]|true|false|null)/.test(afterComma));
      if (closes) {
        out += c;
        inString = false;
      } else if (/["{[]/.test(after) && /[\s]/.test(text[i + 1] || '') && text.slice(i + 1, j).includes('\n')) {
        out += '",'; // the string ended and the next value starts on its own line: only the comma is missing
        inString = false;
      } else out += '\\"';
    }
  }
  return out;
}

/** The JSON object in a model reply, tolerating fences, stray prose, a reasoning block and small slips in the JSON. */
export function replyJson(raw) {
  const text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return JSON');
  const body = text.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch (err) {
    try {
      return JSON.parse(repairJson(body));
    } catch {
      // Not mendable: say where it broke, for the log.
      const at = Number(/position (\d+)/.exec(err.message)?.[1]);
      throw Object.assign(err, Number.isFinite(at) && { near: body.slice(Math.max(0, at - 120), at + 60) });
    }
  }
}
