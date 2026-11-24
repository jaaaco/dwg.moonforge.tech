---
title: Open the DWG house plan your architect sent, no CAD needed
description: Your architect sent the floor plan as a DWG and you have no CAD? Open it in the browser, check a room, get its area and make a PDF. Nothing is uploaded.
key: architect-sent-dwg
locale: en
slug: architect-sent-dwg-file
date: "2026-11-24"
cluster: audience:homeowner
tags:
  - open
  - audience
  - measure
facts: []
tool: home
faq:
  - q: Can I download a free DWG house plan or floor plan from you?
    a: No. We do not publish house plans, only a viewer. It opens any DWG or DXF file you already have, for example the one from your architect.
  - q: Can I give the builder a dimension I measured in the DWG?
    a: First compare your reading with a dimension the architect wrote on the drawing. If they agree, the unit is right. For construction, the approved drawings still decide, not your clicks.
  - q: The architect sent a 3D model as a DWG. Will I see it in 3D?
    a: No. The viewer does not show or render models in 3D. Ask the architect for 2D plans, sections and elevations, or for rendered images.
  - q: Can I change something in the plan and send it back?
    a: Not in our viewer. It displays, measures and exports to PDF, and it does not edit or save drawings. Write your comments on a printed PDF or send a list with the dimensions you measured.
  - q: Will the file open on site without a connection?
    a: The page has to load once with a connection. The file itself is read on your device and is not sent anywhere.
---

# My architect sent me a DWG file. How do I open it?

You do not need AutoCAD, an account or an install. Open the [free DWG viewer](/), drag the file into the window or pick it from your disk or phone. The drawing is read in your browser by GNU LibreDWG compiled to WebAssembly. The plans of your home are not uploaded, so they never reach anyone else's server.

It works in current Chrome, Safari, Firefox and Edge, on Windows, macOS, Linux, iPhone, iPad and Android. On a Mac or a phone it works the same way as on a Windows PC.

## Open the file step by step

1. Save the attachment from the email to your disk or to the files on your phone.
2. Go to the [viewer](/) and choose the file.
3. Wait a moment. A 2.6 MB architectural detail in DWG opened for us in 3.4 s on a desktop and 2.3 s in a phone-sized view. For files above 25 MB the viewer warns that a phone may take a while.
4. Fit the drawing to the screen to see all of it.

If the file does not open, skip to the section on what to ask the architect for. Other routes are covered in [how to open a DWG file without AutoCAD](/open-dwg-without-autocad).

## How do I find my way around a house plan?

Drag to pan (two fingers on a phone), zoom with the mouse wheel or a pinch. If you get lost, fit the drawing to the screen again.

A house project is usually several drawings in one file: ground floor plan, upper floor, roof, sections, elevations. They often sit side by side, so zoom out and look for them as you would on one large sheet of paper.

**Layers** are like transparent sheets the architect sorted things onto: walls, furniture, dimensions, notes, electrics, plumbing. Turn off the ones in your way. Want a clean room layout? Turn off furniture and hatching. Looking for sockets? Keep walls and electrics only. Turning on a frozen layer thaws it, so nothing stays hidden from you.

You will also hear two words. **Model** is the space where the building is drawn at real size, and that is where you measure. A **layout** (or sheet) is the page meant for printing: a border, a title block, and windows onto parts of the model at a scale such as 1:50 or 1:100. If you need a specific sheet with its title block and signature, the reliable source is a PDF from the architect.

## Check a dimension, but check the unit first

Turn on Measure and click points. It snaps to line ends, midpoints, crossings and the nearest point on a line, so you can hit a wall corner exactly. You get the length, dx and dy, the angle and a running total. We checked it against a line whose length is known from the drawing database, and the reading matched exactly. More detail is in our guide to [measuring distances and areas in a DWG](/measure-dwg).

Here is the trap. The drawing unit is read from the file header (a field called INSUNITS), and the header is often wrong. In 2 of the 3 real drawings we tested it was: one declared millimetres and was drawn in centimetres, one declared inches and was metric. That is why the viewer lets you change the unit.

Do this:

1. Find a wall or window with a dimension written by the architect.
2. Measure the same distance.
3. If the digits agree but the unit differs, or the result is ten or a hundred times off, change the unit.
4. Only then measure things the drawing does not state.

## Get the area of a room

Click each corner of the room along the inner face of the walls, and close the outline by returning to the first point. Measure shows the area of the closed outline. The unit setting affects area too, so run the check above first.

Keep in mind this is the area of the outline you clicked. The areas in the architect's schedule follow the method they chose, so use those for contracts and paperwork and treat your own figure as a check.

## Make a PDF for the builder

A crew on site rarely has anything that opens a DWG, but everyone can open a PDF. The export is a vector PDF, so lines stay sharp at any zoom.

1. Choose what to export: the whole drawing, the current view or a window you pick (for example the ground floor plan alone).
2. Choose a sheet from A4 to A0, or Letter, and the orientation: auto, portrait or landscape.
3. Set the scale: fit to sheet, or a fixed scale from 1:1 to 1:1000. For a house plan, 1:50 or 1:100 is typical if it fits the sheet.
4. For an ordinary office printer choose black and white, and pick a line width.
5. Look at the preview, then download.

Sheets and scales are explained further in [convert DWG to PDF](/dwg-to-pdf). If you print at a fixed scale, verify the unit by measuring first: with the wrong unit the scale will be wrong as well.

## What to ask the architect for when something is missing

| What you see | What to ask for |
|---|---|
| The file does not open or shows an error | A copy saved in an older DWG version, or a DXF (our [DXF viewer](/dxf-viewer) works the same way). We do not convert between versions. |
| Parts are missing: the site, furniture, structure | The xrefs "bound" into one file. Xrefs are external drawings the main file points to, and we do not resolve them. |
| Text looks different or sits slightly off | A PDF to compare with. We draw text with an open font (osifont) and do not load missing SHX fonts. |
| You need sheets with title blocks for the council or the bank | The full PDF set. It should be part of the project anyway. |
| You received a 3D model | 2D plans, sections and elevations. We do not show 3D models in 3D. |

Our opinion: it is worth having both. The PDF set is the document you build from, and the DWG lets you check a dimension nobody wrote down.

## What you cannot do here

The viewer does not edit drawings or save changes, does not save to DWG or DXF, and does not export JPG or PNG images. What you see can also differ a little from the architect's screen, mostly in text. If you are curious about what is actually inside the file, read [what a DWG file is](/guides/what-is-a-dwg-file).
