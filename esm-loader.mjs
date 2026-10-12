export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      try {
        return await nextResolve(specifier + '.js', context);
      } catch {
        try {
          return await nextResolve(specifier + '/index.js', context);
        } catch {
          throw err;
        }
      }
    }
    throw err;
  }
}
