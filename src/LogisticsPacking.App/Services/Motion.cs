using System.Numerics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace LogisticsPacking.App.Services;

/// <summary>
/// Плавност: бутоните "потъват" при натискане, плочките се появяват меко една след друга, екраните избледняват при смяна.
/// Ползва неявните преходи на UIElement (Scale/Opacity/Translation) - работят върху GPU и не пречат на оформлението.
/// Изключват се от Настройки (Анимации).
/// </summary>
internal static class Motion
{
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<FrameworkElement, object> Attached = new();

    public static bool Enabled => AppServices.Settings.Animations;

    /// <summary>Натиснатият елемент леко намалява (потъва), при задържане с мишката леко се повдига.</summary>
    public static void Press(FrameworkElement el, float pressed = 0.965f, float hover = 1.0f)
    {
        if (Attached.TryGetValue(el, out _)) return;
        Attached.Add(el, new object());

        el.ScaleTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(120) };
        el.SizeChanged += (_, _) => el.CenterPoint = new Vector3((float)el.ActualWidth / 2, (float)el.ActualHeight / 2, 0);
        var over = false;

        void Set(float s) { if (Enabled) el.Scale = new Vector3(s, s, 1); else el.Scale = Vector3.One; }

        el.PointerEntered += (_, _) => { over = true; Set(hover); };
        el.PointerExited += (_, _) => { over = false; Set(1f); };
        el.PointerCanceled += (_, _) => Set(over ? hover : 1f);
        el.PointerCaptureLost += (_, _) => Set(over ? hover : 1f);
        // Button маркира PointerPressed/Released като обработени -> слушаме и обработените
        el.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => Set(pressed)), true);
        el.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, _) => Set(over ? hover : 1f)), true);
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

    /// <summary>Меко появяване (избледняване + лек подем) със закъснение; елементът трябва да е в дървото.</summary>
    public static void Reveal(FrameworkElement el, int index)
    {
        if (!Enabled) return;
        el.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(260) };
        el.TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(320) };
        el.Opacity = 0;
        el.Translation = new Vector3(0, 16, 0);
        var queue = el.DispatcherQueue;
        _ = Task.Run(async () =>
        {
            await Task.Delay(40 + Math.Min(index, 30) * 28);
            queue.TryEnqueue(() => { el.Opacity = 1; el.Translation = Vector3.Zero; });
        });
    }

    /// <summary>Показва елемент с избледняване (след като Visibility вече е Visible).</summary>
    public static void FadeIn(FrameworkElement el)
    {
        if (!Enabled) { el.Opacity = 1; return; }
        el.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(220) };
        el.Opacity = 0;
        el.DispatcherQueue.TryEnqueue(() => el.Opacity = 1);
    }
}
