---
title: "What is a DWG file? What is inside and how to open one"
description: "DWG is the native, proprietary drawing format of AutoCAD. What a DWG holds, which versions exist, how it differs from DXF and PDF, and how to open one for free."
key: what-is-dwg
locale: en
slug: what-is-a-dwg-file
date: 2026-09-21
cluster: format:what-is-dwg
tags: [format, open, dxf, pdf]
facts: [oda-dwg-native-proprietary, oda-dwg-undocumented, oda-dwg-version-ids, libredwg-beta, librecad-dwg-experimental]
tool: home
faq:
  - q: "Can I open a DWG file without AutoCAD?"
    a: "Yes. A browser viewer like this one opens DWG and DXF on any computer or phone, with no installation. Desktop options are compared in the guide on opening DWG without AutoCAD."
  - q: "Is DWG the same as DXF?"
    a: "No. Both describe the same kind of drawing, but DWG is compact and binary, while DXF is an exchange format that almost every CAD and CAM program can write. Many programs that cannot save DWG can save DXF."
  - q: "Can a DWG be converted to PDF for free?"
    a: "Yes. Open it in the viewer, press PDF, and choose the area, the sheet and the scale. The PDF is vector, so it prints cleanly."
  - q: "Why does my DWG look different in another program?"
    a: "Because the format has no public specification, every program outside Autodesk reads it through its own implementation, and fonts that were not sent with the drawing get replaced. Lines and dimensions are usually the same; text and complex objects are where differences show."
---

# What is a DWG file?

A .dwg file is a technical drawing: a house plan, an electrical layout, a roof detail, a machine part. The Open Design Alliance, the consortium that builds DWG libraries for other CAD vendors, describes DWG as the native and proprietary file format of AutoCAD, and it is also a trademark of Autodesk. Most other CAD programs read it too, which is why it is the format drawings get sent around in.

If you were sent one and just need to see it, you can [open it in your browser](/) for free. Nothing to install, and the file is not uploaded anywhere.

## What is inside a DWG

A DWG is not a picture. It is a database of objects with exact coordinates, which is why you can zoom in forever and why a distance measured on it is real.

- **Geometry:** lines, arcs, circles, polylines, hatches, dimensions and text.
- **Layers:** named groups such as walls, electrical or furniture, which can be switched on and off or frozen.
- **Blocks:** reusable symbols, like a socket, a door or a chair, placed many times and sometimes carrying attributes such as a label or a part number.
- **Model space and layouts:** model space holds the drawing itself at full size, while layouts arrange views of it on sheets with a title block, ready to print.
- **Header settings:** for example the drawing unit. Nobody has to set it to draw, so it is often left wrong. In two of the three real drawings we tested, the unit in the header did not match the drawing.
- **External references:** links to other drawings. If those files were not sent along, parts of the drawing are simply missing.

## A format without a public manual

The Open Design Alliance calls DWG undocumented and proprietary in its own published specification of the format. Software outside Autodesk therefore reads DWG through independent implementations, such as the Open Design Alliance's libraries or GNU LibreDWG, a free C library for DWG files that describes itself as being in beta. This viewer is built on GNU LibreDWG.

That is also why the same DWG can look slightly different in different programs: each one decodes it with its own code, and fonts that were not sent with the drawing are replaced by others.

## DWG versions

The format has changed several times. The first 6 bytes of every DWG file are a version ID, and the Open Design Alliance's specification lists what each one means:

| Version ID | Format version |
|---|---|
| AC1012 | R13 |
| AC1014 | R14 |
| AC1015 | R2000 |
| AC1018 | R2004 |
| AC1021 | R2007 |
| AC1024 | R2010 |
| AC1027 | R2013 |
| AC1032 | R2018 |

An older program cannot always read a newer format. When a file will not open, the usual fix is to ask the sender to save it again in an older version, for example 2013 or 2018, or as DXF.

## DWG, DXF or PDF?

| Format | What it is | Good for |
|---|---|---|
| DWG | Compact binary drawing database | Working on the drawing in CAD |
| DXF | Exchange format for the same kind of drawing | Moving a drawing between different CAD, CAM or laser cutting programs |
| PDF | Fixed pages, an ISO standard | Printing, marking up, sending to someone without CAD |

A DXF opens in almost any CAD program; LibreCAD, a free editor, works with DXF natively, while its own library lists DWG reading as experimental. A PDF opens everywhere but is no longer a drawing you can measure reliably or edit.

## How to open a DWG file

- **In the browser, on any device:** [the free viewer on this site](/) reads the file locally with GNU LibreDWG compiled to WebAssembly. It shows layers, [measures distances and areas](/measure-dwg) and [exports a vector PDF at scale](/dwg-to-pdf).
- **With a desktop program:** the options, what each needs and where each falls short are in [how to open a DWG file without AutoCAD](/open-dwg-without-autocad).
- **On a Mac:** see the [DWG viewer for Mac](/dwg-viewer-mac).
