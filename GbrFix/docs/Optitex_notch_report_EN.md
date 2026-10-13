# Optitex 26 – the last notch of every piece is missing in the HP-GL (HPG) cut file

*(Bulgarian version: `Optitex_notch_report_BG.md`)*

## 1. Summary

When a marker is plotted/exported to the cutter in **HP-GL**, Optitex 26 writes **one notch less than the marker contains on every piece that has notches**. It is always the **last notch of the piece** (the last one in the piece's notch order). All other notches are written correctly. In our test marker this is **28 of 232 notches missing** – exactly one on each of the 28 pieces that have notches. A piece with a single notch loses it completely.

The marker (`.MRK`) and the pattern (`.PDS`) are correct: they contain all notches, all of the same type. Only the cut output omits them.

The same symptom (one notch per piece type missing) was also seen in earlier tests with GBR exports from 26.1 on other markers (30 of 45 notches present); we suspect the same cause but have not verified it on those files here.

## 2. Environment and settings

- Optitex Marker, window title "Optitex Mark 26". Exact build: ______ (please fill in from Help → About).
- Plotter/cutter settings: format **HP-GL**, *HPGL resolution* **Metric 1/40** (1 unit = 0.025 mm), *Use CR/LF in code* on, *Cut Darts and Pleats notches* on; page size X 10000 mm × Y 1800 mm; *Plot only one frame* on, *Plot Marker Header info after Marker* on, *Marker borders* on.
- Output Manager: Machines List.

## 3. Files (attached)

| File | Content |
|---|---|
| `CH-CHINO-Atatex-PR-LICE-32-44.MRK` | the marker: 32 pieces (28 with notches; the 4 `gajka` pieces have none) and 4 more rectangular outlines without a name; 232 notches in total |
| `CH-CHINO-Atatex-pr.PDS` | the pattern; every notch is `T_NOTCH` / `CUT`, 8 mm of cut length per notch (e.g. piece `grub`: COUNT 14, LENGTH 112 mm) |
| `CH-CHINO-ATATEX-PR-LICE-32-44.HPG` | the HP-GL plot of that marker (cut pen `SP2`) |
| `CH-CHINO-ATATEX-PR-LICE-32-44.PLT` | a PLT plot of the same marker in which **all** notches are present (see section 7) |
| `CH-CHINO-ATATEX-PR-LICE-32-44.GBR` | the GBR export of the same marker, for comparison |

## 4. What we expect and what we get

Each T notch in the HPG is written as: edge point E, then `PD` to the inner end I (4 mm in), `PU` to one end of the crossbar, `PD` to the other end (crossbar 4 mm), `PU` back to E, and the contour goes on:

```
PD E; PD I; PU C1; PD C2; PU E; PD <next contour point>
```

| | Notches |
|---|---|
| In the marker (`.MRK` drawing = `.PDS` counts × copies) | **232** |
| Written to the HPG on the cut pen | **204** |
| Missing | **28** |

The 28 missing notches, one per piece. "Marker piece #" is the order of the outlines in the `.MRK` drawing (36 outlines: the 32 pieces and the 4 unnamed rectangles #20, #23, #26, #30); positions are in HPGL units (1/40 mm) and in mm from the marker origin, the same coordinate system as the HPG file:

| Marker piece # | Piece | Notches in marker | Notches in HPG | Missing notch | Position (HPGL units) | Position (mm) |
|---|---|---|---|---|---|---|
| 1 | grub | 14 | 13 | #14 of 14 | 1264, 5892 | 31.6, 147.3 |
| 2 | grub | 14 | 13 | #14 of 14 | 44552, 25456 | 1113.8, 636.4 |
| 3 | pr-liava | 9 | 8 | #9 of 9 | 7032, 29996 | 175.8, 749.9 |
| 4 | grub | 14 | 13 | #14 of 14 | 44548, 44472 | 1113.7, 1111.8 |
| 5 | pr-nasr | 2 | 1 | #2 of 2 | 60932, 54476 | 1523.3, 1361.9 |
| 6 | pr-nasr | 2 | 1 | #2 of 2 | 50080, 55424 | 1252.0, 1385.6 |
| 8 | grub | 14 | 13 | #14 of 14 | 45548, 46316 | 1138.7, 1157.9 |
| 10 | pr-liava | 9 | 8 | #9 of 9 | 85016, 9136 | 2125.4, 228.4 |
| 11 | pr-diasna | 11 | 10 | #11 of 11 | 47984, 19744 | 1199.6, 493.6 |
| 12 | pr-diasna | 11 | 10 | #11 of 11 | 89284, 22800 | 2232.1, 570.0 |
| 13 | gr-nasr | 4 | 3 | #4 of 4 | 46664, 38424 | 1166.6, 960.6 |
| 16 | gr-nasr | 4 | 3 | #4 of 4 | 49680, 30748 | 1242.0, 768.7 |
| 17 | pr-nasr | 2 | 1 | #2 of 2 | 45580, 54484 | 1139.5, 1362.1 |
| 18 | gr-filetka | 8 | 7 | #8 of 8 | 79828, 55700 | 1995.7, 1392.5 |
| 19 | gr-filetka | 8 | 7 | #8 of 8 | 79828, 52380 | 1995.7, 1309.5 |
| 21 | gr-filetka | 8 | 7 | #8 of 8 | 80908, 52380 | 2022.7, 1309.5 |
| 22 | gr-filetka | 8 | 7 | #8 of 8 | 80908, 55700 | 2022.7, 1392.5 |
| 24 | podshlic | 2 | 1 | #2 of 2 | 74336, 33060 | 1858.4, 826.5 |
| 25 | shlic | 1 | 0 | #1 of 1 | 73228, 35380 | 1830.7, 884.5 |
| 27 | pr-nasr | 2 | 1 | #2 of 2 | 71292, 35132 | 1782.3, 878.3 |
| 28 | podshlic | 2 | 1 | #2 of 2 | 86808, 37592 | 2170.2, 939.8 |
| 29 | shlic | 1 | 0 | #1 of 1 | 87920, 35272 | 2198.0, 881.8 |
| 31 | kol-desen | 17 | 16 | #17 of 17 | 89552, 36656 | 2238.8, 916.4 |
| 32 | gr-nasr | 4 | 3 | #4 of 4 | 91244, 50308 | 2281.1, 1257.7 |
| 33 | kol-liav | 20 | 19 | #20 of 20 | 92128, 48652 | 2303.2, 1216.3 |
| 34 | gr-nasr | 4 | 3 | #4 of 4 | 94264, 57580 | 2356.6, 1439.5 |
| 35 | kol-desen | 17 | 16 | #17 of 17 | 97240, 14728 | 2431.0, 368.2 |
| 36 | kol-liav | 20 | 19 | #20 of 20 | 97240, 37728 | 2431.0, 943.2 |

What the table shows:

- **28 of 28 pieces that have notches** lose exactly one notch, and in all 28 it is the **last** notch of the piece in the marker's notch order. (The 4 pieces without notches, `gajka`, are not affected.)
- Notch type does not matter: all are `T_NOTCH`, `CUT`, 8 mm. The missing ones do not differ from the written ones.
- It is not tied to a particular place: the missing notches lie at many different places on pieces of different sizes.
- The same 28 notches are also missing on the inner (sewing) line, which carries a second set of T symbols about 10 mm inside the outline.
- Along the drawn contour the missing notch is also behind all the other notches of that contour for 26 of the 28 pieces (for the two `pr-diasna` pieces it is the last in the list but not at the end of the drawn contour).

## 5. Our guess (we cannot see the code)

The loop that writes the notches of a piece seems to run for `N − 1` notches instead of `N` (an off-by-one), or the last notch of the list is skipped when the contour is closed. Please check the notch output for HP-GL (and the other cut formats, see below).

## 6. Related observation – please confirm whether it is by design

In the GBR export of the same marker, 24 of the 32 pieces and the 4 rectangular outlines are written with all their notches (194 notches). Eight pieces (4 × `gr-filetka`, 2 × `podshlic`, 2 × `shlic` = 38 notches) are **not in the GBR at all**; they lie on top of the four rectangles (each rectangle holds two of them). The HPG draws the rectangles and these 8 pieces. Is it intended that the GBR leaves them out (for example pieces placed over other pieces)? If yes, please tell us and we will not count these 38 as missing in the GBR.

## 7. The same marker plotted as PLT: all notches are present

We also have a PLT plot of the same marker (attached). It is **complete**: all 232 marker notches are written on the cut line, and 232 more on the inner (sewing) line about 10 mm inside the outline (464 T symbols). Every notch of the HPG is also in the PLT, identical to within 0.1 mm. The HPG lacks exactly **56 of the PLT's 464 T symbols**: the 28 on the cut line listed above and 28 on the inner line.

The two files write the notches differently:

| | HPG (notches missing) | PLT (complete) |
|---|---|---|
| Pen | the T is part of the contour, on the cut pen `SP2` | all T symbols on a separate pen `SP4`, written before the contour (`SP2`) of the piece |
| Commands | `PD E; PD I; PU C1; PD C2; PU E` | `PU E; PU E; PD I; PU C1; PD C2` |

We do not know yet which plot settings were different for the PLT (for example a separate tool/pen for notches): ______ (to be filled in). If the notches written on their own pen are complete and those written inside the contour are not, the defect is in the in-contour notch writer.

## 8. What we ask

1. Please confirm the defect and tell us in which build it is fixed.
2. Is there a setting that makes Optitex write the last notch of each piece in HP-GL? The PLT shows that a path which writes all notches exists; please tell us which setting selects it, if it is a setting.
3. Please check the same behaviour for the GBR/ISO output of 26.x.

## 9. How to reproduce

1. Open the attached marker (`.MRK`) with its pattern (`.PDS`).
2. Plot → machine format HP-GL, resolution Metric 1/40, "Cut Darts and Pleats notches" on, plot to a file.
3. Count the T notches on the cut pen (`SP2`) and compare with the notches in the marker: one per piece is missing, the last one.

(For now we put the missing notches back automatically from the `.MRK`, so cutting is possible, but we would like the export itself to be correct.)
