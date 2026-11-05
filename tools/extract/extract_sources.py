#!/usr/bin/env python3
"""
Extract InvoiceGO reference datasets from the client-supplied source documents.

Usage:
    python3 -I tools/extract/extract_sources.py <source_dir> <output_dir>

<source_dir> must contain the original files (names as supplied in the client's
Google Drive folder). Requires: pdfplumber (Python). Only reads the documents;
never executes anything inside them.

Outputs (JSON, UTF-8) — all committed to server/data/:
    source_manifest.json      file names, sizes, SHA-256, document versions
    scenarios.json            Spec §9 — 28 scenario definitions (+ retailer note)
    scenario_templates.json   Scenario Data.docx — 28 JSON examples (raw text kept verbatim)
    sandbox_json_format.json  SANDBOX SIMPLE JASON FORMAT.docx — generic sandbox + production samples
    applicability.json        Spec §10 — complete business-activity x sector matrix (+ anomalies)
    error_codes.json          Spec §7/§8 — every sales and purchase error row (+ duplicates)
    hs_codes.json             PCT Codes docx + HS CODE PDF — catalogue with reconciliation report
"""
import hashlib
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

import pdfplumber

SPEC = "FBR API DOCUMENTATUIN (2).pdf"
FILES = {
    "spec": SPEC,
    "manual": "USER MANUAL.pdf",
    "details": "DETAILS.docx",
    "sandbox_format": "SANDBOX SIMPLE JASON FORMAT.docx",
    "scenario_data": "Scenario Data.docx",
    "pct": "PCT Codes (1).docx",
    "hs_pdf": "HS CODE WITH DISCRIPTION.pdf",
    "sales_errors": "Sales Error Codes from API Documentation.pdf",
    "purchase_errors": "Purchases Error Codes from API Documentation.pdf",
    "scenarios_pdf": "Scenarios for Sandbox Testing from API documentation.pdf",
    "applicability_pdf": "Applicable Scenarios based on Business Activity from API Documentation.pdf",
}
SPEC_VERSION = "DI API Technical Specification v1.12 (PRAL, last updated 24-Jul-2025)"

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def docx_paragraphs(path):
    """Return the text of each w:p paragraph (runs concatenated), in document order."""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    out = []
    for p in root.iter(W_NS + "p"):
        parts = []
        for node in p.iter():
            if node.tag == W_NS + "t" and node.text:
                parts.append(node.text)
            elif node.tag == W_NS + "tab":
                parts.append("\t")
        out.append("".join(parts))
    return out


def norm_ws(s):
    return re.sub(r"\s+", " ", s or "").strip()


# ---------------------------------------------------------------------------
# PDF table helpers (row borders are drawn as double rules ~0.5pt apart)
# ---------------------------------------------------------------------------
def row_borders(page, min_width=400, max_left=110):
    # Only full-width rules starting at the table's left border delimit rows;
    # inner per-column rules (e.g. in the BRIEF_MSG_DESC column) are ignored.
    ys = sorted(e["top"] for e in page.horizontal_edges
                if e["x1"] - e["x0"] > min_width and e["x0"] < max_left)
    borders = []
    i = 0
    while i < len(ys):
        j = i
        while j + 1 < len(ys) and ys[j + 1] - ys[j] < 1.0:
            j += 1
        if j > i:  # a double rule
            borders.append((ys[i] + ys[j]) / 2)
        i = j + 1
    # the outermost (top/bottom) rules may be single lines
    if ys and (not borders or ys[0] < borders[0] - 2):
        borders.insert(0, ys[0])
    if ys and (not borders or ys[-1] > borders[-1] + 2):
        borders.append(ys[-1])
    return borders


def words_in_bands(page, borders, columns):
    """columns: list of (name, x_min, x_max). Returns list of {col: text} per band."""
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
    bands = []
    for a, b in zip(borders, borders[1:]):
        cell = {name: [] for name, _, _ in columns}
        for w in words:
            mid = (w["top"] + w["bottom"]) / 2
            if a < mid < b:
                for name, x0, x1 in columns:
                    if x0 <= w["x0"] < x1:
                        cell[name].append(w)
                        break
        if any(cell.values()):
            bands.append({k: join_words(v) for k, v in cell.items()})
    return bands


def join_words(ws):
    ws = sorted(ws, key=lambda w: (round(w["top"]), w["x0"]))
    lines, cur, cur_top = [], [], None
    for w in ws:
        if cur_top is None or abs(w["top"] - cur_top) <= 2.5:
            cur.append(w["text"])
            cur_top = w["top"] if cur_top is None else cur_top
        else:
            lines.append(" ".join(cur))
            cur, cur_top = [w["text"]], w["top"]
    if cur:
        lines.append(" ".join(cur))
    return " ".join(lines).strip()


# ---------------------------------------------------------------------------
def extract_error_codes(pdf):
    cols = [("code", 0, 120), ("message", 120, 300), ("brief", 300, 1000)]
    rows = []
    for category, pages in (("SALES", range(36, 42)), ("PURCHASE", range(42, 46))):
        for pn in pages:
            page = pdf.pages[pn - 1]
            for band in words_in_bands(page, row_borders(page), cols):
                code = band["code"].strip()
                if not re.fullmatch(r"\d{4}", code):
                    if code or band["message"] or band["brief"]:
                        joined = band["code"] + band["message"] + band["brief"]
                        if "MESSAGE" in joined or "All rights reserved" in joined.replace("  ", " ") \
                                or "rights reserved" in joined:
                            continue  # header row / page footer
                        raise SystemExit(f"Unparsed error band p{pn}: {band}")
                    continue
                rows.append({
                    "code": code,
                    "category": category,
                    "messageDesc": band["message"],
                    "briefMsgDesc": band["brief"],
                    "sourcePage": pn,
                })
    # dedupe per (category, code), keep variants + occurrences
    merged = {}
    for r in rows:
        key = (r["category"], r["code"])
        m = merged.setdefault(key, {
            "code": r["code"], "category": r["category"],
            "messageDesc": r["messageDesc"], "briefMsgDesc": r["briefMsgDesc"],
            "sourcePages": [], "occurrences": 0, "variants": [],
        })
        m["occurrences"] += 1
        m["sourcePages"].append(r["sourcePage"])
        if (r["messageDesc"], r["briefMsgDesc"]) != (m["messageDesc"], m["briefMsgDesc"]):
            known = [(v["messageDesc"], v["briefMsgDesc"]) for v in m["variants"]]
            if (r["messageDesc"], r["briefMsgDesc"]) not in known:
                m["variants"].append({"messageDesc": r["messageDesc"], "briefMsgDesc": r["briefMsgDesc"],
                                      "sourcePage": r["sourcePage"]})
    entries = list(merged.values())
    return {
        "source": SPEC_VERSION + " §7 Sales Error Codes (pp.36-41), §8 Purchase Error Codes (pp.42-45)",
        "rawRowCount": len(rows),
        "rawRows": rows,
        "entries": entries,
        "counts": {
            "SALES": sum(1 for e in entries if e["category"] == "SALES"),
            "PURCHASE": sum(1 for e in entries if e["category"] == "PURCHASE"),
        },
    }


def extract_scenarios(pdf):
    page = pdf.pages[45]  # p.46
    cols = [("id", 0, 105), ("description", 105, 325), ("saleType", 325, 1000)]
    out = []
    # The final table row has no bottom rule: cap the table just above the "Note:" line.
    note_top = min(w["top"] for w in page.extract_words() if w["text"] == "Note:")
    borders = [b for b in row_borders(page) if b < note_top] + [note_top - 1]
    for band in words_in_bands(page, borders, cols):
        if re.fullmatch(r"SN\d{3}", band["id"]):
            out.append({"scenarioId": band["id"], "description": band["description"],
                        "saleTypeLabel": band["saleType"]})
    text = page.extract_text()
    note = re.search(r"Note:\s*(.*retailer in sales tax profile\.)", text)
    if len(out) != 28:
        raise SystemExit(f"Expected 28 scenarios, got {len(out)}: {out}")
    return {
        "source": SPEC_VERSION + " §9 Scenarios for Sandbox Testing (p.46)",
        "note": note.group(1) if note else None,
        "retailerOnly": ["SN026", "SN027", "SN028"],
        "purchaseType": ["SN009"],
        "scenarios": out,
    }


def extract_applicability(pdf):
    rows = []
    for pn in range(47, 52):
        page = pdf.pages[pn - 1]
        cols = [("sr", 0, 72), ("activity", 72, 145), ("sector", 145, 245), ("scenarios", 245, 1000)]
        for band in words_in_bands(page, row_borders(page), cols):
            if not re.fullmatch(r"\d+", band["sr"]):
                continue
            raw = band["scenarios"]
            ids = re.findall(r"SN\d{3}", raw)
            rows.append({
                "sr": int(band["sr"]),
                "businessActivity": band["activity"],
                "sector": band["sector"],
                "scenarioIdsRaw": ids,
                "rawText": raw,
                "sourcePage": pn,
            })
    rows.sort(key=lambda r: r["sr"])
    srs = [r["sr"] for r in rows]
    gaps = [n for n in range(1, max(srs) + 1) if n not in srs]
    anomalies = []
    for r in rows:
        dups = sorted({x for x in r["scenarioIdsRaw"] if r["scenarioIdsRaw"].count(x) > 1})
        if dups:
            anomalies.append({"sr": r["sr"], "type": "DUPLICATE_SCENARIO_IN_ROW", "detail": dups})
    activities = sorted({r["businessActivity"] for r in rows})
    sectors = []
    for r in rows:
        if r["sector"] not in sectors:
            sectors.append(r["sector"])
    pharma_without_025 = [r["sr"] for r in rows if r["sector"] == "Pharmaceuticals" and "SN025" not in r["scenarioIdsRaw"]]
    for sr in pharma_without_025:
        anomalies.append({"sr": sr, "type": "PHARMA_ROW_WITHOUT_SN025",
                          "detail": "Other activities + Pharmaceuticals include SN025; this row does not."})
    return {
        "source": SPEC_VERSION + " §10 Applicable Scenarios based on Business Activity (pp.47-51)",
        "rows": rows,
        "rowNumberGaps": gaps,
        "anomalies": anomalies,
        "businessActivities": activities,
        "sectors": sectors,
    }


# ---------------------------------------------------------------------------
def balanced_json_block(lines, start):
    depth, buf, in_str, esc = 0, [], False, False
    for i in range(start, len(lines)):
        line = lines[i]
        buf.append(line)
        for ch in line:
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
        if depth == 0 and any("{" in l for l in buf):
            return buf, i
    raise SystemExit("Unbalanced JSON block")


def extract_scenario_templates(path):
    paras = [p for p in docx_paragraphs(path)]
    nonempty = [p for p in paras if p.strip()]
    out = []
    i = 0
    while i < len(nonempty):
        # headings may share a paragraph with a text-box title, so search rather than match
        m = re.search(r"\b(S?N\d{3,4})\s*:\s*([^\"{}]*)$", nonempty[i])
        if m:
            label, title = m.group(1), m.group(2).strip()
            j = i + 1
            while not nonempty[j].lstrip().startswith("{"):
                j += 1  # skip repeated page titles between heading and JSON
            block, end = balanced_json_block(nonempty, j)
            raw = "\n".join(block)
            parsed = json.loads(raw)
            sid = parsed.get("scenarioId")
            anomalies = []
            if label != sid:
                anomalies.append(f"Heading label '{label}' differs from embedded scenarioId '{sid}'")
            contract_header = {"invoiceType", "invoiceDate", "sellerNTNCNIC", "sellerBusinessName", "sellerProvince",
                               "sellerAddress", "buyerNTNCNIC", "buyerBusinessName", "buyerProvince", "buyerAddress",
                               "buyerRegistrationType", "invoiceRefNo", "scenarioId", "items"}
            extra = sorted(set(parsed) - contract_header)
            missing = sorted(contract_header - set(parsed))
            if extra:
                anomalies.append(f"Non-contract header field(s): {', '.join(extra)}")
            if missing:
                anomalies.append(f"Missing contract header field(s): {', '.join(missing)}")
            for n, it in enumerate(parsed.get("items", []), 1):
                if it.get("extraTax") == "":
                    anomalies.append(f"Item {n}: extraTax is an empty string (contract type is Number)")
            out.append({"label": label, "title": title, "scenarioId": sid, "raw": raw,
                        "json": parsed, "anomalies": anomalies})
            i = end + 1
        else:
            i += 1
    ids = [t["scenarioId"] for t in out]
    if len(out) != 28 or len(set(ids)) != 28:
        raise SystemExit(f"Expected 28 unique scenario templates, got {ids}")
    return {"source": "Scenario Data.docx (client supplied)", "templates": out}


def extract_sandbox_format(path):
    paras = [p for p in docx_paragraphs(path) if p.strip()]
    blocks, i = [], 0
    while i < len(paras):
        if paras[i].strip().startswith("{"):
            block, end = balanced_json_block(paras, i)
            blocks.append("\n".join(block))
            i = end + 1
        else:
            i += 1
    if len(blocks) != 2:
        raise SystemExit(f"Expected 2 JSON blocks in sandbox format doc, got {len(blocks)}")
    return {
        "source": "SANDBOX SIMPLE JASON FORMAT.docx (client supplied)",
        "sandboxTemplateRaw": blocks[0],
        "sandboxTemplate": json.loads(blocks[0]),
        "productionSampleRaw": blocks[1],
        "productionSampleNote": "Sample contains placeholder text for NTN/CNIC and is not valid JSON for a real request.",
    }


# ---------------------------------------------------------------------------
CODE_LINE = re.compile(r"^\s*(\d{4}\.\d{4})\s*(.*?)\s*$")


def is_fragment_text(desc):
    """Text that can only be the continuation of a wrapped description."""
    d = desc.strip()
    if d == "":
        return False
    if d[0] in ",;(":
        return True
    if re.match(r"^(and|or|except)\b", d):
        return True
    return d[0].islower()


def expects_continuation(text):
    t = text.rstrip()
    return bool(t) and (t.endswith((",", "/", "(", "-")) or
                        re.search(r"\b(and|or|of|chapter|headings?|sub-headings?|for|the|with|to)$", t, re.I) is not None)


def parse_catalogue_lines(lines, source_name):
    """lines: list of (line_no, text). Returns records + continuation/rejected reports.

    The source is a flattened two-column table. Wrapped description lines that
    begin with a tariff number (e.g. "8703.2195 , 8703.2240 and") look like new
    rows; they are merged into the preceding record instead:
      * text starting with , ; ( and/or/except or a lowercase letter -> fragment
      * a bare code after text that expects continuation ("... and", "...,")  -> fragment
      * a bare code out of sequence (not after the previous record, or another chapter) -> fragment
      * otherwise a bare code is a real record whose description is empty in the source
    """
    records, order, continuations, rejected, alternates_count = {}, [], [], [], 0
    last = None          # last record/occurrence receiving text
    last_code = None     # last real record code (sequence check)
    empty_desc = []
    for ln, text in lines:
        t = text.strip()
        if not t:
            continue
        if t.startswith("PCT Code"):
            continue  # header
        m = CODE_LINE.match(t)
        if not m:
            rejected.append({"line": ln, "text": t, "reason": "Line does not start with a dotted 8-digit code"})
            continue
        code, desc = m.group(1), norm_ws(m.group(2))
        if desc == "":
            in_sequence = last_code is not None and code > last_code and code[:2] in (
                last_code[:2], f"{int(last_code[:2]) + 1:02d}")
            fragment = last is not None and (expects_continuation(last["fullDescription"]) or not in_sequence)
        else:
            fragment = last is not None and is_fragment_text(desc)
        if fragment:
            frag = norm_ws(code + " " + desc)
            last["fullDescription"] = norm_ws(last["fullDescription"] + " " + frag)
            continuations.append({"line": ln, "text": t, "mergedInto": last["code"], "mergedIntoLine": last["_line"]})
            continue
        if last is None and is_fragment_text(desc):
            rejected.append({"line": ln, "text": t, "reason": "Continuation fragment before any record"})
            continue
        if desc == "":
            empty_desc.append({"line": ln, "code": code})
        if code in records:
            rec = records[code]
            occ = {"code": code, "description": desc, "fullDescription": desc, "line": ln, "_line": ln}
            rec["_occurrences"].append(occ)
            rec["sourceLines"].append(ln)
            last = occ
            last_code = code
            continue
        rec = {"code": code, "description": desc, "fullDescription": desc, "alternates": [],
               "sourceLines": [ln], "_line": ln, "_occurrences": []}
        records[code] = rec
        order.append(code)
        last = rec
        last_code = code
    # Fold repeated occurrences into alternates (never discard differing descriptions)
    for rec in records.values():
        seen = {rec["fullDescription"]}
        for occ in rec.pop("_occurrences"):
            if occ["fullDescription"] not in seen:
                seen.add(occ["fullDescription"])
                rec["alternates"].append({"description": occ["fullDescription"], "line": occ["line"],
                                          "source": source_name})
                alternates_count += 1
        if rec["description"] == "" and rec["fullDescription"]:
            rec["description"] = rec["fullDescription"]
    return records, order, continuations, rejected, alternates_count, empty_desc


def extract_catalogue(pct_path, hs_pdf_path):
    pct_lines = list(enumerate(docx_paragraphs(pct_path), 1))
    pct_lines = [(n, t) for n, t in pct_lines if t.strip()]
    recs, order, conts, rejected, alt_n, empty_desc = parse_catalogue_lines(pct_lines, "PCT Codes (1).docx")

    # Secondary source: HS CODE WITH DISCRIPTION.pdf — compare line by line
    hs_lines = []
    with pdfplumber.open(hs_pdf_path) as pdf:
        for pn, page in enumerate(pdf.pages, 1):
            for t in (page.extract_text() or "").split("\n"):
                if t.strip():
                    hs_lines.append((f"p{pn}", t))
    hs_recs, hs_order, hs_conts, hs_rej, _, _ = parse_catalogue_lines(hs_lines, "HS CODE WITH DISCRIPTION.pdf")
    only_pct = sorted(set(recs) - set(hs_recs))
    only_hs = sorted(set(hs_recs) - set(recs))
    desc_diff = []
    for code in order:
        if code in hs_recs and norm_ws(hs_recs[code]["description"]) != norm_ws(recs[code]["description"]):
            desc_diff.append({"code": code, "pct": recs[code]["description"], "hs": hs_recs[code]["description"]})
            recs[code]["alternates"].append({"description": hs_recs[code]["description"],
                                             "line": hs_recs[code]["sourceLines"][0],
                                             "source": "HS CODE WITH DISCRIPTION.pdf"})
    for code in only_hs:  # never discard: import with HS-PDF provenance
        r = hs_recs[code]
        recs[code] = {**r, "alternates": r["alternates"]}
        order.append(code)

    fragment_codes = set()
    for c in conts:
        fragment_codes.update(re.findall(r"\d{4}\.\d{4}", c["text"]))
    codes_only_in_fragments = sorted(fragment_codes - set(recs))

    out_records = []
    for code in order:
        r = recs[code]
        out_records.append({
            "code": code,
            "description": r["description"],
            "fullDescription": r["fullDescription"],
            "alternates": r["alternates"],
            "chapter": code[:2],
            "heading": code[:4],
            "sourceLines": r["sourceLines"],
            "source": "PCT Codes (1).docx" if code not in only_hs else "HS CODE WITH DISCRIPTION.pdf",
        })
    out_records.sort(key=lambda r: r["code"])
    return {
        "sources": ["PCT Codes (1).docx", "HS CODE WITH DISCRIPTION.pdf"],
        "stats": {
            "pctNonEmptyLines": len(pct_lines),
            "uniqueCodes": len(out_records),
            "continuationLinesMerged": len(conts),
            "alternateDescriptions": sum(len(r["alternates"]) for r in out_records),
            "rejectedLines": len(rejected),
            "hsPdfUniqueCodes": len(hs_recs),
            "codesOnlyInPct": len(only_pct),
            "codesOnlyInHsPdf": len(only_hs),
            "primaryDescriptionDifferences": len(desc_diff),
            "codesSeenOnlyInsideContinuationText": len(codes_only_in_fragments),
            "recordsWithEmptyDescriptionLine": len(empty_desc),
        },
        "records": out_records,
        "reconciliation": {
            "continuations": conts,
            "rejected": rejected,
            "hsPdfRejected": hs_rej,
            "codesOnlyInPct": only_pct,
            "codesOnlyInHsPdf": only_hs,
            "primaryDescriptionDifferences": desc_diff,
            "codesSeenOnlyInsideContinuationText": codes_only_in_fragments,
            "recordsWithEmptyDescriptionLine": empty_desc,
        },
    }


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    manifest = []
    for key, name in FILES.items():
        p = os.path.join(src, name)
        manifest.append({"key": key, "file": name, "bytes": os.path.getsize(p), "sha256": sha256(p)})

    def dump(name, data):
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        print("wrote", name)

    with pdfplumber.open(os.path.join(src, SPEC)) as pdf:
        dump("error_codes.json", extract_error_codes(pdf))
        dump("scenarios.json", extract_scenarios(pdf))
        dump("applicability.json", extract_applicability(pdf))
    dump("scenario_templates.json", extract_scenario_templates(os.path.join(src, FILES["scenario_data"])))
    dump("sandbox_json_format.json", extract_sandbox_format(os.path.join(src, FILES["sandbox_format"])))
    dump("hs_codes.json", extract_catalogue(os.path.join(src, FILES["pct"]), os.path.join(src, FILES["hs_pdf"])))
    dump("source_manifest.json", {"specVersion": SPEC_VERSION, "manualVersion": "DI User Manual v1.5 (29-Jul-2025)",
                                  "files": manifest})


if __name__ == "__main__":
    main()
