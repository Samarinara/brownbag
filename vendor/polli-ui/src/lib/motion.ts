import * as React from "react";
import { AccessibilityInfo, Animated } from "react-native";
export function useReducedMotion() {
  const [reduced, setReduced] = React.useState(true);
  React.useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {
        /* Keep motion disabled if the preference is unavailable. */
      });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduced;
}
/** No motion on mount. A changed action key triggers one short animation. */
export function useActionAnimation(key: unknown) {
  const progress = React.useRef(new Animated.Value(1)).current;
  const previous = React.useRef(key);
  const reduced = useReducedMotion();
  React.useEffect(() => {
    if (reduced) {
      previous.current = key;
      progress.setValue(1);
      return;
    }
    if (Object.is(previous.current, key)) return;
    previous.current = key;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [key, reduced, progress]);
  return progress;
}
