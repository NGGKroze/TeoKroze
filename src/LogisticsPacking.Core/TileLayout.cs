namespace LogisticsPacking.Core;

/// <summary>Изчислява решетка от плочки, която се събира в зададена площ (без скролиране).</summary>
public static class TileLayout
{
    public readonly record struct Result(int Cols, int Rows, double TileWidth, double TileHeight);

    public static Result Compute(
        int count, double width, double height, double spacing = 16,
        double maxW = 380, double maxH = 210, double minAspect = 1.15, double maxAspect = 2.1)
    {
        if (count <= 0 || width <= 0 || height <= 0) return new Result(1, 1, 0, 0);
        var best = new Result(1, count, 0, 0);
        double bestArea = -1;
        for (var cols = 1; cols <= count; cols++)
        {
            var rows = (int)Math.Ceiling(count / (double)cols);
            var cellW = (width - (cols - 1) * spacing) / cols;
            var cellH = (height - (rows - 1) * spacing) / rows;
            if (cellW <= 0 || cellH <= 0) continue;
            var w = Math.Min(cellW, maxW);
            var h = Math.Min(cellH, maxH);
            if (w > h * maxAspect) w = h * maxAspect;   // не прекалено широка плочка
            if (w < h * minAspect) h = w / minAspect;   // не прекалено висока плочка
            var area = w * h;
            if (area > bestArea + 0.5) { bestArea = area; best = new Result(cols, rows, w, h); }
        }
        return best;
    }
}
