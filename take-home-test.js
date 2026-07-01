/**
 * Estimated waiting time for a walk-in clinic queue.
 *
 * Assumptions: all doctors are free at t=0, patients have no doctor
 * preference, and each patient is assigned to whichever doctor becomes
 * free soonest.
 */

/* ----------------------------------------------------------------------- *
 * Errors
 * ----------------------------------------------------------------------- */

class QueueingError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
}

class InvalidDoctorError extends QueueingError {}
class EmptyDoctorListError extends QueueingError {}
class InvalidQueuePositionError extends QueueingError {}

/* ----------------------------------------------------------------------- *
 * Doctor — immutable, validated eagerly so an invalid instance can never
 * exist once constructed.
 * ----------------------------------------------------------------------- */

class Doctor {
  /**
   * @param {string} name - Non-empty display name.
   * @param {number} avgConsultationTime - Finite number > 0, in minutes.
   * @throws {InvalidDoctorError}
   */
  constructor(name, avgConsultationTime) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new InvalidDoctorError(
        `Doctor name must be a non-empty string, received: ${JSON.stringify(name)}`
      );
    }

    if (
      typeof avgConsultationTime !== 'number' ||
      !Number.isFinite(avgConsultationTime) ||
      avgConsultationTime <= 0
    ) {
      throw new InvalidDoctorError(
        `Doctor "${name}" has an invalid avgConsultationTime: ${JSON.stringify(avgConsultationTime)}. ` +
          'It must be a finite number greater than 0.'
      );
    }

    this._name = name;
    this._avgConsultationTime = avgConsultationTime;
    Object.freeze(this);
  }

  get name() {
    return this._name;
  }

  get avgConsultationTime() {
    return this._avgConsultationTime;
  }
}

/* ----------------------------------------------------------------------- *
 * PriorityQueue — generic binary min-heap. Keeps "which doctor is next
 * free" lookups at O(log k) instead of rescanning every doctor per patient.
 * ----------------------------------------------------------------------- */

class PriorityQueue {
  /** @param {(a: *, b: *) => number} comparator */
  constructor(comparator = (a, b) => a - b) {
    this._heap = [];
    this._compare = comparator;
  }

  get size() {
    return this._heap.length;
  }

  push(value) {
    this._heap.push(value);
    this._siftUp(this._heap.length - 1);
  }

  /** @returns {*} The smallest element, or `undefined` if empty. */
  pop() {
    if (this._heap.length === 0) return undefined;

    const top = this._heap[0];
    const last = this._heap.pop();

    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._siftDown(0);
    }

    return top;
  }

  _siftUp(index) {
    let childIndex = index;
    while (childIndex > 0) {
      const parentIndex = Math.floor((childIndex - 1) / 2);
      if (this._compare(this._heap[childIndex], this._heap[parentIndex]) >= 0) break;
      this._swap(childIndex, parentIndex);
      childIndex = parentIndex;
    }
  }

  _siftDown(index) {
    let parentIndex = index;
    const length = this._heap.length;
    while (true) {
      const leftIndex = 2 * parentIndex + 1;
      const rightIndex = 2 * parentIndex + 2;
      let smallestIndex = parentIndex;

      if (leftIndex < length && this._compare(this._heap[leftIndex], this._heap[smallestIndex]) < 0) {
        smallestIndex = leftIndex;
      }
      if (rightIndex < length && this._compare(this._heap[rightIndex], this._heap[smallestIndex]) < 0) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === parentIndex) break;

      this._swap(parentIndex, smallestIndex);
      parentIndex = smallestIndex;
    }
  }

  _swap(i, j) {
    [this._heap[i], this._heap[j]] = [this._heap[j], this._heap[i]];
  }
}

/* ----------------------------------------------------------------------- *
 * calculateWaitingTime
 * ----------------------------------------------------------------------- */

const NO_WAIT_TIME_MINUTES = 0;
const FIRST_QUEUE_POSITION = 1;

/**
 * @param {*} doctors
 * @throws {EmptyDoctorListError|InvalidDoctorError}
 */
function assertValidDoctorList(doctors) {
  if (!Array.isArray(doctors) || doctors.length === 0) {
    throw new EmptyDoctorListError('At least one doctor is required to calculate a waiting time.');
  }

  doctors.forEach((doctor, index) => {
    if (!(doctor instanceof Doctor)) {
      throw new InvalidDoctorError(
        `doctors[${index}] is not a Doctor instance, received: ${JSON.stringify(doctor)}`
      );
    }
  });
}

/**
 * @param {*} position
 * @throws {InvalidQueuePositionError}
 */
function assertValidQueuePosition(position) {
  if (
    typeof position !== 'number' ||
    !Number.isInteger(position) ||
    position < FIRST_QUEUE_POSITION
  ) {
    throw new InvalidQueuePositionError(
      `position must be an integer >= ${FIRST_QUEUE_POSITION}, received: ${JSON.stringify(position)}`
    );
  }
}

/**
 * @param {Doctor[]} doctors - Non-empty array of `Doctor` instances.
 * @param {number} position - 1-indexed position in the queue.
 * @throws {EmptyDoctorListError} If `doctors` is empty or not an array.
 * @throws {InvalidDoctorError} If `doctors` contains a non-`Doctor` element.
 * @throws {InvalidQueuePositionError} If `position` is not an integer >= 1.
 * @returns {number} Estimated waiting time in minutes.
 */
function calculateWaitingTime(doctors, position) {
  assertValidDoctorList(doctors);
  assertValidQueuePosition(position);

  if (position === FIRST_QUEUE_POSITION) return NO_WAIT_TIME_MINUTES;

  const availability = new PriorityQueue((a, b) => a.availableAtMinute - b.availableAtMinute);
  doctors.forEach((doctor) => {
    availability.push({ availableAtMinute: NO_WAIT_TIME_MINUTES, consultationTime: doctor.avgConsultationTime });
  });

  let waitingTime = NO_WAIT_TIME_MINUTES;

  for (let seen = 0; seen < position; seen++) {
    const nextFreeSlot = availability.pop();
    waitingTime = nextFreeSlot.availableAtMinute;

    availability.push({
      availableAtMinute: nextFreeSlot.availableAtMinute + nextFreeSlot.consultationTime,
      consultationTime: nextFreeSlot.consultationTime,
    });
  }

  return waitingTime;
}

/* ----------------------------------------------------------------------- *
 * Command-line input
 * ----------------------------------------------------------------------- */

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const lineQueue = [];
const pendingResolvers = [];
let inputClosed = false;

rl.on('line', (line) => {
  if (pendingResolvers.length > 0) pendingResolvers.shift().resolve(line);
  else lineQueue.push(line);
});

rl.on('close', () => {
  inputClosed = true;
  while (pendingResolvers.length > 0) {
    pendingResolvers.shift().reject(new Error('Input ended before all questions were answered.'));
  }
});

function ask(query) {
  process.stdout.write(query);
  return new Promise((resolve, reject) => {
    if (inputClosed) reject(new Error('Input ended before all questions were answered.'));
    else if (lineQueue.length > 0) resolve(lineQueue.shift());
    else pendingResolvers.push({ resolve, reject });
  });
}

/**
 * Repeatedly prompts until `parse(raw)` produces a value `validate` accepts.
 * @param {string} query
 * @param {(raw: string) => *} parse
 * @param {(value: *) => boolean} validate
 * @param {string} errorMessage - Shown when the parsed value fails validation.
 */
async function askValidated(query, parse, validate, errorMessage) {
  for (;;) {
    const raw = await ask(query);
    const value = parse(raw);
    if (validate(value)) return value;
    console.log(errorMessage);
  }
}

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isPositiveFiniteNumber = (value) => Number.isFinite(value) && value > 0;

async function main() {
  const doctorCount = await askValidated(
    'Number of doctors: ',
    (raw) => parseInt(raw, 10),
    isPositiveInteger,
    'Number of doctors must be a positive integer.'
  );

  const doctors = [];
  for (let i = 0; i < doctorCount; i++) {
    const name = await askValidated(
      `Doctor ${i + 1} name: `,
      (raw) => raw.trim(),
      (value) => value.length > 0,
      'Doctor name must not be empty.'
    );

    const avgConsultationTime = await askValidated(
      `Doctor ${i + 1} average consultation time (minutes): `,
      (raw) => parseFloat(raw),
      isPositiveFiniteNumber,
      'Average consultation time must be a positive number.'
    );

    doctors.push(new Doctor(name, avgConsultationTime));
  }

  const position = await askValidated(
    'Patient position in queue: ',
    (raw) => parseInt(raw, 10),
    isPositiveInteger,
    'Queue position must be a positive integer (starting from 1).'
  );

  console.log(`Estimated waiting time: ${calculateWaitingTime(doctors, position)} minutes`);
  rl.close();
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  rl.close();
  process.exitCode = 1;
});
