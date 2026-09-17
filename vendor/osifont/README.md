# osifont

`osifont.ttf` and `osifont.woff` from <https://github.com/hikikomori82/osifont> (version 0.1.20221020, file `osifont.woff`),
an ISO 3098 technical lettering font by Zefram Cochrane.

The viewer uses it for all drawing text instead of AutoCAD SHX or Microsoft fonts,
which cannot be redistributed.

`osifont-dwg.woff` is a modified version made by `scripts/make_font.py`: glyphs scaled 115%
horizontally, so text wraps where it did in the SHX or Arial font the drawing was made with.
`scripts/prepare-cad.mjs` publishes it to `public/cad/fonts/`.

## Licence

Distributed under GNU GPL version 3 with GPL font exception (quoted from the font's name table):

> As a special exception, if you create a document which uses this font, and embed this font or
> unaltered portions of this font into the document, this font does not by itself cause the
> resulting document to be covered by the GNU General Public License. This exception does not
> however invalidate any other reasons why the document might be covered by the GNU General Public
> License. If you modify this font, you may extend this exception to your version of the font, but
> you are not obligated to do so. If you do not wish to do so, delete this exception statement from
> your version.
