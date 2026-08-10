import json, os, statistics, time
from pathlib import Path
from poc01_geometry import extract_editable_geometry

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
    assert st["texts"]==306, st
    assert all(st[k]>0 for k in ("lines","polylines","paths","circles","ellipses","rectangles")), st
    target=[e for e in data["entities"] if e["bbox"][2]<75 and 170<e["bbox"][1]<200]
    roles={e.get("role") for e in target}; types={e["t"] for e in target}
    assert "ring_symbol" in roles and "outlined_text" in roles and "line" in types and "polyline" in types, (roles,types)
    rings=[e for e in data["entities"] if e.get("role")=="ring_symbol" and e["bbox"][2]<75 and 150<e["bbox"][1]<930]
    assert len(rings)==18, len(rings)
    scale,rows=calibration_test(); avg=statistics.mean(r["error_pct"] for r in rows); mx=max(r["error_pct"] for r in rows)
    assert avg<=0.5 and mx<=1.0, (avg,mx,rows)
    report={"source_items":st["source_items"],"editable_entities":st["entities"],"types":{k:st[k] for k in ("lines","polylines","paths","circles","ellipses","rectangles","texts")},"extract_seconds_reported":st["seconds"],"extract_wall_seconds":wall,"target_left_column_rings":len(rings),"calibration_cm_per_point":scale,"calibration_rows":rows,"calibration_avg_error_pct":avg,"calibration_max_error_pct":mx}
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=="__main__": main()
