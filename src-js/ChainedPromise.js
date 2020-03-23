/*
 * Copyright 2015-2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import fix from './fix';

/**
 * An extended promise for recurring promises with multiple compositions.
 *
 * ```javascript
 * var chained = ChainedPromise.from(promise);
 * chained.flatMap(a).flatMap(b).flatMap(c).forEach(fn).catch(onRejected);
 * ```
 *
 * is equivalent to:
 *
 * ```javascript
 * promise.then(a).then(b).then(c).then(fn).then((v) => v.next)
 *        .then(a).then(b).then(c).then(fn).then((v) => v.next)
 *        .then(a).then(b).then(c).then(fn).then((v) => v.next)
 *        ...
 *        .catch(onRejected);
 * ```
 *
 * `(v) => v.next` function is the default {@link ChainedPromise#next} value
 * picker. We can supply custom value picker to the {@link
 * ChainedPromise#constructor} and {@link ChainedPromise#from}.
 */

/*
type SkipToken = {
  data: symbol,
  next: ChainedPromise
};
*/


class ChainedPromise extends Promise {

  /*Value type
  Array<(v: any) => Promise<any>>;
  */
  
  flatMapChain;

  /**
   * Function to construct promise to next item in chain.
   * value type
   * (t: T) => Promise<T>;
   */

  next;

  /**
   * Initializes fields common to both {@link ChainedPromise#constructor}
   * and {@link ChainedPromise#from} code path.
   */
  
   initialize() {
    this.flatMapChain = [];
  }

  /**
   * Constructs next {@link ChainedPromise} that carries over settings and
   * composition properties of the current one.
   */

  nextPromise(v) {
    let nextPromise;
    if ((v).data &&
        (v).data === ChainedPromise.SKIP) {
      nextPromise = ChainedPromise.from((v).next, this.next);
    } else {
      nextPromise = ChainedPromise.from(this.next(v), this.next);
    }
    nextPromise.flatMapChain = this.flatMapChain;
    return (nextPromise);
  }

  /**
   * @param executor Promise executor
   * @param next
   */

  constructor(executor, next = ChainedPromise.nextFieldPicker('next')) {
    super(executor);
    this.next = next;
    this.initialize();
  }

  /**
   * Creates a ChainedPromise that extends given Promise.
   */

  static from(
      innerPromise,
      next = ChainedPromise.nextFieldPicker('next')) {
    return new ChainedPromise((res, rej) => innerPromise.then(res, rej), next);
  }

  /**
   * Returns a function to pick the given attribute.
   * @param {string} attr Name of the attribute (that will contain the next promise).
   * @returns {function(T) : Promise.<T>}
   * @template T
   */

  static nextFieldPicker(attr) {
    return (x) => x[attr];
  }

  /**
   * Creates `[ChainedPromise, callback, error]` array.
   *
   * Calling callback with a value `v` will cause the promise to be resolved
   * into
   * `{data: v, next: nextPromise}`, `nextPromise` being another {@link
   * ChainedPromise} who gets resolved next time `callback` is called.
   *
   * Calling `error` function will cause the promise to be rejected.
   * @returns {Array}
   * @template T
   */

  static createPromiseCallbackPair() {
    let resolver;
    let rejecter;
    const callback = (v) => {
      const oldResolver = resolver;
      const nextPromise = new ChainedPromise((resolve, reject) => {
        resolver = resolve;
        rejecter = reject;
      });
      oldResolver({data: v, next: nextPromise});
    };
    const error = (err) => {
      rejecter(err);
    };
    const promise = new ChainedPromise((resolve, reject) => {
      resolver = resolve;
      rejecter = reject;
    });
    return [promise, callback, error];
  }

  /**
   * Applies the given function on all values in the chain, until the {@link
   * ChainedPromise#next} value returns an object with {@link
   * ChainedPromise.DONE} symbol.
   */

  forEach(fn) {
    return fix((v, complete) => {
      let nextPromise;
      if ((v).data &&
          (v).data === ChainedPromise.SKIP) {
        nextPromise = (v).next;
      } else {
        fn(v);
        nextPromise = this.next(v);
      }
      if (nextPromise[ChainedPromise.DONE] !== undefined) {
        return complete(nextPromise[ChainedPromise.DONE]);
      } else {
        return this.nextPromise(v);
      }
    })(this);
  }

  /**
   * Stacks up flat map operation to be performed in this promise. See {@link
   * ChainedPromise} for examples.
   */

  flatMap(fn) {
    this.flatMapChain.push(fn);
    return (this);
  }

  /**
   * Non-async equivalent of {@link ChainedPromise#flatMap}.
   */

  map(fn) {
    this.flatMap((v) => new ChainedPromise((res) => res(fn(v))));
    return (this);
  }

  /**
   * Overrides Promise.then to compose with extra functions. See {@link
   * ChainedPromise} for the specifics of available compositions.
   */

  then(onFulfilled, onRejected) {
    if (!onFulfilled) {
      // Skip processing in case of Promise.catch call.
      // TODO: fix type.
      return super.then(onFulfilled, onRejected);
    }
    // Branch out no-op special case, since "super" in ES6 is not a first-class
    // citizen.
    if (this.flatMapChain.length === 0) {
      // TODO: fix type.
      return super.then(onFulfilled, onRejected);
    } else {
      const firstFlatMapped = super.then(this.flatMapChain[0]);
      let flatMapped = this.flatMapChain.slice(1).reduce((x, y) => {
        return x.then((res) => {
          if (res.data && res.data === ChainedPromise.SKIP) {
            return res;
          }
          return y(res);
        });
      }, firstFlatMapped);
      return flatMapped.then(onFulfilled, onRejected);
    }
  }

  /**
   * Flat-maps current promise chain to resolve into successive accumulation of
   * values, from given accumulator. Accumulator should pass on next promise to
   * the accumulated value.
   * @param fn Accumulator that takes previous accumulation and current value,
   * and calculate next accumulation.
   * @param initial Initial accumulated value to start with.
   */

  accumulate(fn) {
    let accumulated = initial;
    this.flatMap((v) => fn(accumulated, v)).map((acc) => {
      accumulated = acc;
      return acc;
    });
    return (this);
  }

  /**
   * Takes a join spec and flatMaps current ChainedPromise accordingly. A join
   * spec is recursively defined as follows:
   *
   *   * If the spec is a function taking a value and returning a promise, then
   * the join operation evaluates the function with current value and replaces
   * the value with the resulting promise.
   *
   *   * If the spec is an array of a spec, then the current value is assumed to
   * be an array, and each element in the current value is mapped to the inner
   * spec.
   *
   *   * If the spec is an object with keys to specs, then the field of the
   * current value with each key is replaced with the result of each join
   * operations with the inner spec.
   * @param {(function(T): (Promise.<U>) | Array | Object)} spec
   * @returns {ChainedPromise.<V>}
   * @template T
   * @template U
   * @template V
   */

  join(spec) {
    this.flatMap((v) => {
      function pickAndJoin(curSpec, curValue) {
        if (typeof curSpec === 'function') {
          return curSpec(curValue);
        }
        if (curSpec instanceof Array) {
          // TODO(yiinho): more thorough error handling.
          return Promise.all(curValue.map((x) => pickAndJoin(curSpec[0], x)));
        }
        if (curSpec instanceof Object) {
          return Promise
              .all(Object.keys(curSpec).map(
                  (key) => pickAndJoin(curSpec[key], curValue[key])
                               .then((joinResult) => {
                                 const result = {};
                                 result[key] = joinResult;
                                 return result;
                               })))
              .then((joinedValues) => {
                joinedValues.forEach((join) => Object.assign(curValue, join));
                return curValue;
              });
        }
        throw new TypeError(
            'Specification not recognized: ' + JSON.stringify(spec));
      }
      return pickAndJoin(spec, v);
    });
    return this;
  }

  /**
   * Collects results (including the final "done" value) into an array.
   * @param fn Mapper function to be applied to each data points (except
   * the final "done" value) before collecting into the result array.
   */
  collect(fn) {
    const collected = [];
    return this
        .forEach((v) => {
          collected.push(fn(v));
        })
        .then((done) => {
          collected.push(done);
          return collected;
        });
  }

  /**
   * Filters for values that evaluates to `true`.
   */
  filter(fn) {
    return this.map((v) => {
      if (!fn(v)) {
        return {data: ChainedPromise.SKIP, next: this.next(v)};
      }
      return v;
    });
  }

  /**
   * Symbol to indicate the end of promise chains. Having
   * `{[ChainedPromise.DONE]: <some value>}` as a next value will indicate the
   * end of the chain, and will cause fixed promises such as
   * {@link ChainedPromise#forEach} to resolve to the given value.
   */
  static DONE = Symbol('ChainedPromise.DONE');

  static SKIP = Symbol('ChainedPromise.SKIP');
}

export default ChainedPromise;
