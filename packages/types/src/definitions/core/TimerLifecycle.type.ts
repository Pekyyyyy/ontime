export enum TimerLifeCycle {
  onLoad = 'onLoad',
  onStart = 'onStart',
  onPause = 'onPause',
  onStop = 'onStop',
  onClock = 'onClock',
  onUpdate = 'onUpdate',
  onFinish = 'onFinish',
  onWarning = 'onWarning',
  onDanger = 'onDanger',
  /** a timeline cue had its GO, or a test */
  onCueGo = 'onCueGo',
  /** a panic stopped the running cues */
  onCuePanic = 'onCuePanic',
}

export type TimerLifeCycleKey = keyof typeof TimerLifeCycle;

export const timerLifecycleValues: string[] = Object.keys(TimerLifeCycle);
