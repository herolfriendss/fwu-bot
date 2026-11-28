// Pure check of a message/interaction payload against Discord's documented limits.
// Used by the command smoke test so that a reply that Discord would reject (HTTP 400,
// "interaction failed") is caught before staging. Returns human-readable violations.
const plain = (value) => (value && typeof value.toJSON === "function" ? value.toJSON() : value);
const len = (value) => (typeof value === "string" ? value.length : 0);

export const DISCORD_LIMITS = Object.freeze({
  content: 2000,
  embeds: 10,
  embedTitle: 256,
  embedDescription: 4096,
  embedFields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  embedTotal: 6000,
  rows: 5,
  rowItems: 5,
  customId: 100,
  buttonLabel: 80,
  selectOptions: 25,
  optionLabel: 100,
  optionValue: 100,
  optionDescription: 100,
  placeholder: 150,
});

export function payloadLimitViolations(input) {
  const out = [];
  const payload = plain(input);
  if (payload == null || typeof payload !== "object") {
    if (typeof payload === "string" && payload.length > DISCORD_LIMITS.content) out.push(`content ${payload.length} > 2000`);
    return out;
  }
  const L = DISCORD_LIMITS;
  if (len(payload.content) > L.content) out.push(`content ${len(payload.content)} > ${L.content}`);
  const embeds = Array.isArray(payload.embeds) ? payload.embeds.map(plain) : [];
  if (embeds.length > L.embeds) out.push(`${embeds.length} embeds > ${L.embeds}`);
  let total = 0;
  embeds.forEach((embed, i) => {
    if (!embed || typeof embed !== "object") return;
    const fields = Array.isArray(embed.fields) ? embed.fields : [];
    const sizes = [len(embed.title), len(embed.description), len(embed.footer?.text), len(embed.author?.name)];
    if (sizes[0] > L.embedTitle) out.push(`embed ${i} title ${sizes[0]} > ${L.embedTitle}`);
    if (sizes[1] > L.embedDescription) out.push(`embed ${i} description ${sizes[1]} > ${L.embedDescription}`);
    if (sizes[2] > L.footer) out.push(`embed ${i} footer ${sizes[2]} > ${L.footer}`);
    if (sizes[3] > L.author) out.push(`embed ${i} author ${sizes[3]} > ${L.author}`);
    if (fields.length > L.embedFields) out.push(`embed ${i} has ${fields.length} fields > ${L.embedFields}`);
    total += sizes.reduce((a, b) => a + b, 0);
    fields.forEach((field, f) => {
      if (len(field?.name) > L.fieldName) out.push(`embed ${i} field ${f} name ${len(field.name)} > ${L.fieldName}`);
      if (len(field?.value) > L.fieldValue) out.push(`embed ${i} field ${f} value ${len(field.value)} > ${L.fieldValue}`);
      if (field && (!len(field.name) || !len(field.value))) out.push(`embed ${i} field ${f} has an empty name or value`);
      total += len(field?.name) + len(field?.value);
    });
  });
  if (total > L.embedTotal) out.push(`embeds total ${total} > ${L.embedTotal}`);
  const rows = Array.isArray(payload.components) ? payload.components.map(plain) : [];
  // Components V2 containers (type 17) follow other rules: only classic action rows are checked.
  const actionRows = rows.filter((row) => row?.type === 1 || (row && !row.type && Array.isArray(row.components)));
  if (actionRows.length && actionRows.length === rows.length && rows.length > L.rows) out.push(`${rows.length} rows > ${L.rows}`);
  actionRows.forEach((row, r) => {
    const items = (row.components ?? []).map(plain);
    if (items.length > L.rowItems) out.push(`row ${r} has ${items.length} items > ${L.rowItems}`);
    const ids = new Set();
    items.forEach((item, c) => {
      if (!item) return;
      const where = `row ${r} item ${c}`;
      if (len(item.custom_id) > L.customId) out.push(`${where} custom_id ${len(item.custom_id)} > ${L.customId}`);
      if (item.custom_id) {
        if (ids.has(item.custom_id)) out.push(`${where} duplicate custom_id ${item.custom_id}`);
        ids.add(item.custom_id);
      }
      if (len(item.label) > L.buttonLabel) out.push(`${where} label ${len(item.label)} > ${L.buttonLabel}`);
      if (len(item.placeholder) > L.placeholder) out.push(`${where} placeholder ${len(item.placeholder)} > ${L.placeholder}`);
      const options = Array.isArray(item.options) ? item.options : [];
      if (options.length > L.selectOptions) out.push(`${where} has ${options.length} options > ${L.selectOptions}`);
      options.forEach((option, o) => {
        if (len(option?.label) > L.optionLabel) out.push(`${where} option ${o} label > ${L.optionLabel}`);
        if (len(option?.value) > L.optionValue) out.push(`${where} option ${o} value > ${L.optionValue}`);
        if (len(option?.description) > L.optionDescription) out.push(`${where} option ${o} description > ${L.optionDescription}`);
      });
    });
  });
  return out;
}
