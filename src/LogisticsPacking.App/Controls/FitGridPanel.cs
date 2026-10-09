using LogisticsPacking.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace LogisticsPacking.App.Controls;

/// <summary>
/// Подрежда плочките в решетка, която ВИНАГИ се събира в наличното място (без скролиране).
/// Избира броя колони така, че плочките да са възможно най-големи; при по-малко плочки (търсене) те растат.
/// </summary>
public sealed class FitGridPanel : Panel
{
    public double Spacing { get; set; } = 16;
    public double MaxTileWidth { get; set; } = 380;
    public double MaxTileHeight { get; set; } = 210;
    /// <summary>Най-тясната позволена плочка (ширина/височина).</summary>
    public double MinAspect { get; set; } = 1.15;
    public double MaxAspect { get; set; } = 2.1;

    private TileLayout.Result _layout;

    protected override Size MeasureOverride(Size availableSize)
    {
        var width = double.IsInfinity(availableSize.Width) ? 1100 : availableSize.Width;
        var height = double.IsInfinity(availableSize.Height) ? 600 : availableSize.Height;
        _layout = TileLayout.Compute(Children.Count, width, height, Spacing, MaxTileWidth, MaxTileHeight, MinAspect, MaxAspect);
        foreach (var child in Children) child.Measure(new Size(_layout.TileWidth, _layout.TileHeight));
        return new Size(width, height);
    }

    protected override Size ArrangeOverride(Size finalSize)
    {
        var (cols, rows, w, h) = (_layout.Cols, _layout.Rows, _layout.TileWidth, _layout.TileHeight);
        if (Children.Count == 0) return finalSize;
        var totalH = rows * h + (rows - 1) * Spacing;
        var top = Math.Max(0, (finalSize.Height - totalH) / 2);
        for (var r = 0; r < rows; r++)
        {
            var inRow = Math.Min(cols, Children.Count - r * cols);
            var rowW = inRow * w + (inRow - 1) * Spacing;
            var left = Math.Max(0, (finalSize.Width - rowW) / 2);   // последният ред се центрира
            for (var c = 0; c < inRow; c++)
                Children[r * cols + c].Arrange(new Rect(left + c * (w + Spacing), top + r * (h + Spacing), w, h));
        }
        return finalSize;
    }
}
