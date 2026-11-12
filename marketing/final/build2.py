# Final cut v3: 3D opening + dealer top-up (take 1) + closing-agent take (take 2) + AG Grid re-bid clip + finance agent + 3D close.
import subprocess
F1 = "crop=3024:1700:0:244"        # take 1 (demo-raw.mp4)
F2 = "crop=2990:1682:28:246"       # take 2 (demo2-raw.mp4)
# (input, start, end, length, crop, narration starting at this part or None)
P = [
  (1, 3.4, 20.5, 7.6, F1, "d1"),     # dealer funds its balance with PayPal
  (2, 2.8, 33.5, 8.8, F2, "d2"),     # Maria asks; the agent qualifies her
  (2, 33.5, 45.5, 3.8, F2, "d3"),    # one-time code
  (2, 45.5, 85.1, 9.0, F2, "d4"),    # sealed bids
  (2, 85.1, 111.0, 13.3, F2, "n5"),  # fine print, real cost
  (2, 111.0, 140.0, 14.0, F2, "n6"), # closing agent negotiates and accepts
  (2, 140.0, 158.5, 11.4, F2, "n7"), # Agent Toolkit order, PayPal approval, capture
  (2, 158.5, 168.5, 5.3, F2, "d8"),  # gas card by Payouts
  (2, 170.0, 183.4, 9.5, F2, "n9"),  # dealer: fees and AG Charts
  (3, 0, 22.5, 22.5, None, None),    # AG Grid live re-bid (own narration)
  (2, 183.4, 200.5, 9.0, F2, "n11"), # finance agent refund through the Agent Toolkit
  (2, 201.7, 206.5, 3.5, F2, None),  # donut shows the refund
]
OPEN, CLOSE = (0, 38.6), (119.2, 130.7)
ins = ["-i", "reverso-3d-v2.mp4", "-i", "demo-raw.mp4", "-i", "demo2-raw.mp4", "-i", "final/rebid-clip.mov"]
vos = [p[5] for p in P if p[5]]
for v in vos: ins += ["-i", f"final/vo/{v}.wav"]
f = ["[0:v]split=2[o0][o1];[0:a]asplit=2[oa0][oa1]",
     f"[o0]trim={OPEN[0]}:{OPEN[1]},setpts=PTS-STARTPTS,fade=t=out:st={OPEN[1]-OPEN[0]-0.3}:d=0.3[va];[oa0]atrim={OPEN[0]}:{OPEN[1]},asetpts=PTS-STARTPTS[aa]",
     f"[o1]trim={CLOSE[0]}:{CLOSE[1]},setpts=PTS-STARTPTS,fade=t=in:d=0.3[vc];[oa1]atrim={CLOSE[0]}:{CLOSE[1]},asetpts=PTS-STARTPTS[ac]"]
uses = {1: sum(p[0] == 1 for p in P), 2: sum(p[0] == 2 for p in P)}
for src, n in uses.items(): f.append(f"[{src}:v]split={n}" + "".join(f"[s{src}_{i}]" for i in range(n)))
cnt, vids, auds, t = {1: 0, 2: 0}, ["[va]"], ["[aa]"], OPEN[1] - OPEN[0]
for k, (src, a, b, ln, crop, vo) in enumerate(P):
    if src == 3:
        f.append(f"[3:v]fps=30[v{k}];[3:a]aresample=48000,adelay={int(t*1000)}|{int(t*1000)}[ra]"); auds.append("[ra]")
    else:
        lab = f"s{src}_{cnt[src]}"; cnt[src] += 1
        fi = ",fade=t=in:d=0.3" if k == 0 else ""
        f.append(f"[{lab}]trim={a}:{b},setpts=(PTS-STARTPTS)/{(b-a)/ln:.4f},{crop},scale=1920:1080:flags=lanczos,fps=30,trim=0:{ln}{fi}[v{k}]")
        if vo:
            j = 4 + vos.index(vo); d = int(t * 1000) + 250
            f.append(f"[{j}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay={d}|{d}[a{k}]"); auds.append(f"[a{k}]")
    vids.append(f"[v{k}]"); t += ln
f[-1] = f[-1]  # keep
f.append(f"[vc]null[vcl]"); vids.append("[vcl]")
f.append(f"[ac]adelay={int(t*1000)}|{int(t*1000)}[acl]"); auds.append("[acl]")
T = t + CLOSE[1] - CLOSE[0]
f.append("".join(vids) + f"concat=n={len(vids)}:v=1:a=0[v]")
f.append("".join(auds) + f"amix=inputs={len(auds)}:normalize=0:duration=longest,atrim=0:{T},loudnorm=I=-16:TP=-1.5[ao]")
print(f"total {T:.1f}s")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-stats", *ins, "-filter_complex", ";".join(f), "-map", "[v]", "-map", "[ao]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
  "final/reverso-hackathon-v3.mp4"], check=True)
