import json, os, statistics, time
from pathlib import Path
from poc01_geometry import extract_editable_geometry

FULL_PDF = Path(os.environ["POC01_FULL_PDF"]) if os.environ.get("POC01_FULL_PDF") else None

PDF = Path(os.environ.get("POC01_PDF", "ايهاب(1).pdf"))

def calibration_test():
    # Ground-floor left vertical grid chain in ايهاب(1).pdf.
    # Written dimensions: 320, 290, 190, ..., 470, 500; total = 2980 cm.
    # Vector Y coordinates are the corresponding grid axes extracted from the PDF.
    y=[184.44,260.88,330.36,375.72,385.32,409.20,428.40,461.88,495.36,509.76,538.44,555.12,583.80,610.20,634.08,665.16,777.60,897.24]
    labels=[320,290,190,40,100,80,140,140,60,120,70,120,110,100,130,470,500]
    scale=sum(labels)/(y[-1]-y[0])
    rows=[]
    for i in [0,1,2,15,16]:
        measured=(y[i+1]-y[i])*scale; actual=labels[i]
        rows.append({"dimension":actual,"measured":measured,"error_pct":abs(measured-actual)/actual*100})
    return scale, rows

def main():
    if not PDF.exists():
        raise SystemExit(f"Set POC01_PDF to the real ايهاب(1).pdf path; missing: {PDF}")
    t=time.perf_counter(); data=extract_editable_geometry(PDF); wall=time.perf_counter()-t
    st=data["stats"]
    assert st["source_items"]==128827, st
    assert st["texts"]==307, st
    assert data["dimension_unit"]["unit"]=="cm" and data["dimension_unit"]["confidence"]=="inferred", data["dimension_unit"]
    assert all(t.get("chars") for t in data["texts"]), "PDF text must preserve per-glyph origins"
    assert all(st[k]>0 for k in ("lines","polylines","paths","circles","ellipses","rectangles")), st
    target=[e for e in data["entities"] if e.get("role") and e["bbox"][2]<75 and 170<e["bbox"][1]<200]
    roles=[e.get("role") for e in target]
    assert sorted(roles)==["outlined_text","ring_symbol","symbol_marker"], roles
    assert len(target)==3, "one double-ring bubble must select as ring + numeral + marker"
    assert all(e["t"]=="path" and len(e.get("source_ids",[]))>=2 for e in target), target
    rings=[e for e in data["entities"] if e.get("role")=="ring_symbol" and e["bbox"][2]<75 and 150<e["bbox"][1]<930]
    assert len(rings)==18, len(rings)
    assert sum(e.get("role")=="symbol_marker" for e in data["entities"])==120
    assert st["seconds"]<10, st["seconds"]
    scale,rows=calibration_test(); avg=statistics.mean(r["error_pct"] for r in rows); mx=max(r["error_pct"] for r in rows)
    assert avg<=0.5 and mx<=1.0, (avg,mx,rows)
    full_report=None
    if FULL_PDF and FULL_PDF.exists():
        full=extract_editable_geometry(FULL_PDF,1)
        full_texts=full["texts"]
        riser=next((t for t in full_texts if "RISER = 16 cm" in t["text"]),None)
        assert riser, "subset-font glyph IDs must recover the original CAD text"
        assert not any("\ufffd" in t["text"] for t in full_texts), "no undecoded subset-font glyphs"
        assert full["dimension_unit"]["unit"]=="m" and full["dimension_unit"]["confidence"]=="explicit"
        assert full["stats"]["wall_entities"]==332, full["stats"]
        full_report={"texts":len(full_texts),"replacement_glyphs":0,"decoded_sample":riser["text"],"unit":full["dimension_unit"],"wall_entities":full["stats"]["wall_entities"]}
    report={"source_items":st["source_items"],"editable_entities":st["entities"],"types":{k:st[k] for k in ("lines","polylines","paths","circles","ellipses","rectangles","texts")},"detected_dimension_unit":data["dimension_unit"],"extract_seconds_reported":st["seconds"],"extract_wall_seconds":wall,"target_symbol_logical_parts":len(target),"target_left_column_rings":len(rings),"all_symbol_markers":sum(e.get("role")=="symbol_marker" for e in data["entities"]),"calibration_cm_per_point":scale,"calibration_rows":rows,"calibration_avg_error_pct":avg,"calibration_max_error_pct":mx}
    if full_report: report["full_drawing_layout_regression"]=full_report
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=="__main__": main()
