"""Extract all tables from the 6.3 docx (no python-docx needed). Usage: docx_tables.py path [out.json]"""
import sys, zipfile, re, json
import xml.etree.ElementTree as ET
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
def tables(path):
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read("word/document.xml"))
    out = []
    for tbl in root.iter(W + "tbl"):
        rows = []
        for tr in tbl.findall(W + "tr"):
            cells = []
            for tc in tr.findall(W + "tc"):
                paras = []
                for p in tc.iter(W + "p"):
                    paras.append("".join(t.text or "" for t in p.iter(W + "t")))
                cells.append("\n".join(x for x in paras if x).strip())
            rows.append(cells)
        out.append(rows)
    return out
if __name__ == "__main__":
    t = tables(sys.argv[1])
    if len(sys.argv) > 2:
        json.dump(t, open(sys.argv[2], "w", encoding="utf8"), ensure_ascii=False, indent=0)
    for i, tb in enumerate(t):
        print("TABLE", i, "rows", len(tb))
        for r in tb[:6]:
            print("   ", r)
