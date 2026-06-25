// Default workout days. Exercise NAMES + rep schemes + a seed entry of current weights
// (taken from the user's own log). `db` = curated free-exercise-db id for the illustration.
//   reps:   per-set rep targets (also sets how many weight fields the log form shows)
//   seed:   per-set starting weights → becomes the first logged entry (a baseline point)
//   effort: low | medium | high for that seed entry
// Bodyweight moves (no `seed`) just get rep labels and no baseline point.
//
// Edit freely — the app seeds from here on first run.

function ex(name, muscle, db, opts = {}) {
  return {
    name, muscle, db: db || null,
    finisher: !!opts.finisher,
    reps: opts.reps || [],
    seed: opts.seed || null,
    effort: opts.effort || 'medium',
  };
}

export const DEFAULT_DAYS = [
  {
    name: 'Chest & Triceps',
    muscles: ['Chest', 'Triceps'],
    exercises: [
      ex('Flat Bench Press', 'Chest', 'Barbell_Bench_Press_-_Medium_Grip', { reps: [15, 12, 10, 8], seed: [25, 27.5, 30, 30], effort: 'medium' }),
      ex('Cable Crossover', 'Chest', 'Cable_Crossover', { reps: [15, 12, 10, 8], seed: [55, 55, 55, 60], effort: 'medium' }),
      ex('Incline / Decline Dumbbell Press', 'Chest', 'Incline_Dumbbell_Press', { reps: [12, 10, 8, 8], seed: [20, 20, 20, 20], effort: 'medium' }),
      ex('Diamond Push-Up', 'Triceps', 'Close-Grip_Push-Up_off_of_a_Dumbbell', { reps: [12, 10, 8] }),
      ex('Tricep Pushdown (Cable)', 'Triceps', 'Triceps_Pushdown', { reps: [15, 15, 12, 10], seed: [27.5, 30, 30, 32.5], effort: 'medium' }),
      ex('Assisted Tricep Dips (Machine)', 'Triceps', 'Dip_Machine', { reps: [12, 10, 8, 8], seed: [120, 120, 120, 120], effort: 'medium' }),
      ex('Pull-Up', 'Back', 'Pullups', { finisher: true, reps: [8] }),
      ex('Plank', 'Abdominals', 'Plank', { finisher: true, reps: [1] }),
    ],
  },
  {
    name: 'Back & Biceps',
    muscles: ['Back', 'Biceps'],
    exercises: [
      ex('Lat Pulldown (Cable)', 'Back', 'Wide-Grip_Lat_Pulldown', { reps: [15, 15, 12, 12], seed: [85, 85, 85, 85], effort: 'medium' }),
      ex('Rear Deltoid Row Machine', 'Back', 'Cable_Rope_Rear-Delt_Rows', { reps: [15, 15, 12, 12], seed: [55, 55, 55, 55], effort: 'high' }),
      ex('Barbell Row', 'Back', 'Bent_Over_Barbell_Row', { reps: [15, 12, 10, 8], seed: [40, 40, 50, 50], effort: 'medium' }),
      ex('Dumbbell Bicep Curl', 'Biceps', 'Dumbbell_Bicep_Curl', { reps: [15, 12, 10, 8], seed: [22.5, 22.5, 22.5, 22.5], effort: 'high' }),
      ex('Preacher Curl', 'Biceps', 'Preacher_Curl', { reps: [12, 10, 8, 8], seed: [30, 30, 30, 30], effort: 'medium' }),
      ex('Seated Incline Dumbbell Curl', 'Biceps', 'Incline_Dumbbell_Curl', { reps: [12, 10, 8, 8], seed: [15, 15, 17.5, 17.5], effort: 'high' }),
      ex('Plank', 'Abdominals', 'Plank', { finisher: true, reps: [1] }),
    ],
  },
  {
    name: 'Legs (Intense)',
    muscles: ['Quadriceps', 'Hamstrings'],
    exercises: [
      ex('Deadlift', 'Lower Back', 'Barbell_Deadlift', { reps: [12, 10, 8, 6], seed: [60, 70, 80, 80], effort: 'high' }),
      ex('Weighted Squat', 'Quadriceps', 'Weighted_Squat', { reps: [15, 12, 10, 8], seed: [35, 35, 35, 35], effort: 'medium' }),
      ex('Walking Lunges', 'Quadriceps', 'Bodyweight_Walking_Lunge', { reps: [15, 12, 10, 8], seed: [30, 30, 30, 30], effort: 'medium' }),
      ex('Leg Extension', 'Quadriceps', 'Leg_Extensions', { reps: [15, 12], seed: [50, 50], effort: 'medium' }),
      ex('Leg Curl', 'Hamstrings', 'Lying_Leg_Curls', { reps: [15, 12], seed: [70, 70], effort: 'medium' }),
      ex('Weighted Hip Thrust', 'Glutes', 'Barbell_Hip_Thrust', { reps: [15, 12, 10], seed: [50, 50, 50], effort: 'medium' }),
      ex('EZ-Bar Calf Raise', 'Calves', 'Standing_Barbell_Calf_Raise', { reps: [12, 10, 8, 8], seed: [35, 35, 35, 35], effort: 'medium' }),
      ex('Pull-Up', 'Back', 'Pullups', { finisher: true, reps: [8] }),
      ex('Plank', 'Abdominals', 'Plank', { finisher: true, reps: [1] }),
    ],
  },
  {
    name: 'Shoulders & Abs',
    muscles: ['Shoulders', 'Abdominals'],
    exercises: [
      ex('Seated Dumbbell Shoulder Press', 'Shoulders', 'Dumbbell_Shoulder_Press', { reps: [15, 15, 12, 12], seed: [22.5, 22.5, 25, 25], effort: 'high' }),
      ex('Dumbbell Side Lateral Raise', 'Shoulders', 'Side_Lateral_Raise', { reps: [15, 15, 12, 12], seed: [12.5, 12.5, 12.5, 12.5], effort: 'high' }),
      ex('Dumbbell Shrugs', 'Shoulders', 'Dumbbell_Shrug', { reps: [15, 15, 15, 15], seed: [40, 40, 40, 40], effort: 'medium' }),
      ex('Dumbbell Reverse Fly', 'Shoulders', 'Reverse_Flyes', { reps: [15, 12, 10, 10], seed: [12.5, 12.5, 12.5, 12.5], effort: 'medium' }),
      ex('Weighted Russian Twist', 'Abdominals', 'Russian_Twist', { reps: [15, 12, 10], seed: [35, 35, 35], effort: 'high' }),
      ex('Ab Machine Crunch', 'Abdominals', 'Ab_Crunch_Machine', { reps: [8, 8, 7], seed: [110, 120, 130], effort: 'high' }),
      ex('Leg Raise', 'Abdominals', 'Hanging_Leg_Raise', { reps: [15, 12, 10] }),
      ex('Assisted Chin-Up', 'Back', 'Chin-Up', { finisher: true, reps: [10], seed: [50], effort: 'medium' }),
    ],
  },
];
