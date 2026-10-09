// Pull the analyst-relevant sections out of a 10-K/10-Q: Risk Factors (Item 1A) and MD&A
// (Item 7 in a 10-K, Item 2 in a 10-Q). Filings repeat item headings in the table of
// contents, so take the LAST heading occurrence that is followed by substantial text.
function extractSections(text, form, { includeLegal = false } = {}) {
  const sections = [];
  const grab = (label, startRe, endRe) => {
    const starts = [...text.matchAll(startRe)].map((m) => m.index);
    for (let i = starts.length - 1; i >= 0; i--) {
      const rest = text.slice(starts[i]);
      const endMatch = rest.slice(200).search(endRe);
      const body = endMatch > 0 ? rest.slice(0, endMatch + 200) : rest;
      if (body.length > 3000) {
        sections.push({ label, body });
        return;
      }
    }
  };
  if (form === "10-K") {
    grab("Item 1A. Risk Factors", /item\s*1a\.?\s*[\-–—:]?\s*risk\s+factors/gi, /item\s*1b\.?|item\s*1c\.?|item\s*2\.?\s*[\-–—:]?\s*properties/i);
    grab("Item 7. Management's Discussion and Analysis", /item\s*7\.?\s*[\-–—:]?\s*management['’]?s\s+discussion/gi, /item\s*7a\.?|item\s*8\.?\s*[\-–—:]?\s*financial\s+statements/i);
    if (includeLegal) grab("Item 3. Legal Proceedings", /item\s*3\.?\s*[\-–—:]?\s*legal\s+proceedings/gi, /item\s*4\.?\s*[\-–—:]?\s*mine\s+safety|item\s*5\.?/i);
  } else if (form === "10-Q") {
    grab("Item 2. Management's Discussion and Analysis", /item\s*2\.?\s*[\-–—:]?\s*management['’]?s\s+discussion/gi, /item\s*3\.?\s*[\-–—:]?\s*quantitative/i);
    grab("Item 1A. Risk Factors (updates)", /item\s*1a\.?\s*[\-–—:]?\s*risk\s+factors/gi, /item\s*2\.?\s*[\-–—:]?\s*unregistered|item\s*5\.?|item\s*6\.?\s*[\-–—:]?\s*exhibits/i);
    if (includeLegal) grab("Part II Item 1. Legal Proceedings", /part\s*ii[\s\S]{0,20}item\s*1\.?\s*[\-–—:]?\s*legal\s+proceedings/gi, /item\s*1a\.?|item\s*2\.?\s*[\-–—:]?\s*unregistered/i);
  }
  return sections;
}

module.exports = { extractSections };
