// Runs async jobs one at a time. Store updates are read-modify-write (read the list, change it,
// save it), so two at once could overwrite each other — e.g. two screens registering together.
// One lock per process; the home server is one process. (Cloudflare KV can't be locked this way,
// but there writes are rare and come from people tapping, not from screens at the same moment.)
export function makeLock() {
  let tail = Promise.resolve();
  return function run(job) {
    const result = tail.then(job, job);
    tail = result.catch(() => {});
    return result;
  };
}
