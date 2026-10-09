using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Windows.Foundation;

namespace LogisticsPacking.App.Services;

/// <summary>
/// Плавност: бутоните "потъват" при натискане, плочките се появяват меко една след друга, екраните избледняват при смяна.
/// Само класически Storyboard анимации върху CompositeTransform и Opacity (без неявните преходи на UIElement -
/// те сриваха Microsoft.UI.Xaml.dll на някои машини). Изключват се от Настройки (Анимации) и автоматично при срив.
/// </summary>
internal static class Motion
{
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<FrameworkElement, Storyboard?[]> Running = new();

    public static bool Enabled => AppServices.Settings.Animations;

    private static CompositeTransform Transform(FrameworkElement el)
    {
        if (el.RenderTransform is CompositeTransform c) return c;
        c = new CompositeTransform();
        el.RenderTransformOrigin = new Point(0.5, 0.5);
        el.RenderTransform = c;
        return c;
    }

    private static DoubleAnimation Anim(DependencyObject target, string property, double to, int ms, int beginMs = 0)
    {
        var a = new DoubleAnimation
        {
            To = to,
            Duration = new Duration(TimeSpan.FromMilliseconds(ms)),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
            EnableDependentAnimation = true,
        };
        if (beginMs > 0) a.BeginTime = TimeSpan.FromMilliseconds(beginMs);
        Storyboard.SetTarget(a, target);
        Storyboard.SetTargetProperty(a, property);
        return a;
    }

    /// <summary>Натиснатият елемент леко намалява (потъва), при задържане с мишката леко се повдига.</summary>
    public static void Press(FrameworkElement el, float pressed = 0.965f, float hover = 1.0f)
    {
        if (!Enabled || Running.TryGetValue(el, out _)) return;   // без анимации - нищо не се закача (промяната важи след рестарт)
        var slot = new Storyboard?[1];
        Running.Add(el, slot);
        var tr = Transform(el);
        var over = false;

        void To(double s, int ms)
        {
            slot[0]?.Stop();
            if (!Enabled) { tr.ScaleX = tr.ScaleY = 1; return; }
            var sb = new Storyboard();
            sb.Children.Add(Anim(tr, "ScaleX", s, ms));
            sb.Children.Add(Anim(tr, "ScaleY", s, ms));
            slot[0] = sb;
            sb.Begin();
        }

        el.PointerEntered += (_, _) => { over = true; To(hover, 160); };
        el.PointerExited += (_, _) => { over = false; To(1, 160); };
        el.PointerCanceled += (_, _) => To(over ? hover : 1, 140);
        el.PointerCaptureLost += (_, _) => To(over ? hover : 1, 140);
        // Button маркира PointerPressed/Released като обработени -> слушаме и обработените
        el.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => To(pressed, 80)), true);
        el.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, _) => To(over ? hover : 1, 160)), true);
    }

    /// <summary>Закача Press на всички бутони под корена (без тези, които вече имат).</summary>
    public static void PressAll(DependencyObject root)
    {
        var n = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < n; i++)
        {
            var c = VisualTreeHelper.GetChild(root, i);
            if (c is Button b) Press(b);
            PressAll(c);
        }
    }

    /// <summary>Меко появяване (избледняване + лек подем) със закъснение.</summary>
    public static void Reveal(FrameworkElement el, int index)
    {
        if (!Enabled) return;
        var tr = Transform(el);
        el.Opacity = 0;
        tr.TranslateY = 16;
        var delay = 30 + Math.Min(index, 30) * 28;
        var sb = new Storyboard();
        sb.Children.Add(Anim(el, "Opacity", 1, 260, delay));
        sb.Children.Add(Anim(tr, "TranslateY", 0, 320, delay));
        sb.Completed += (_, _) => { el.Opacity = 1; tr.TranslateY = 0; };
        sb.Begin();
    }

    /// <summary>Показва елемент с избледняване (след като Visibility вече е Visible).</summary>
    public static void FadeIn(FrameworkElement el)
    {
        if (!Enabled) { el.Opacity = 1; return; }
        el.Opacity = 0;
        var sb = new Storyboard();
        sb.Children.Add(Anim(el, "Opacity", 1, 220));
        sb.Completed += (_, _) => el.Opacity = 1;
        sb.Begin();
    }
}
