import setStyle from './set-style';
const { React, ReactDOM, ICEDesignBase } = window;

// feature-detect support for event listener options
let supportsPassive = false;
try {
  addEventListener('test', null, {
    get passive() {
      supportsPassive = true;
    }
  });
} catch (e) { }

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];

export default ({ worker, tagNamePrefix = '' }) => {
  const NODES = new Map();

  function setNode(vnode, node) {
    node.$$id = vnode.$$id;
    return NODES.set(vnode.$$id, node);
  }

  function getNode(vnode) {
    if (!vnode) return null;
    if (vnode.nodeName === 'BODY') return body;
    return NODES.get(vnode.$$id);
  }

  function deleteNode(vnode) {
    if (!vnode) return null;
    return NODES.delete(vnode.$$id);
  }

  function addEvent(props, name) {
    let listenKey = 'on' + name[0].toUpperCase() + name.slice(1);
    props[listenKey] = eventProxyHandler;
  }

  function removeEvent(props, name) {
    let listenKey = 'on' + name[0].toUpperCase() + name.slice(0, 1);
    delete props[listenKey];
  }

  let touch;
  function getTouch(e) {
    let t = e.changedTouches && e.changedTouches[0] ||
      e.touches && e.touches[0] || e;
    return t && { pageX: t.pageX, pageY: t.pageY };
  }

  function serializeTouchList(touchList) {
    const touches = [];
    for (let i = 0, l = touchList.length; i < l; i++) {
      const {
        clientX, clientY,
        pageX, pageY,
        identifier, target
      } = touchList[i];

      touches.push({
        clientX, clientY,
        pageX, pageY,
        identifier,
        // instance id of changed target
        $$id: target.$$id,
      });
    }
    return touches;
  }

  function eventProxyHandler(e) {
    e.stopPropagation();
    if (e.type === 'click' && touch) return false;

    let event = { type: e.type };
    if (e.currentTarget && e.currentTarget.dataset.targetId) event.target = e.currentTarget.dataset.targetId;
    if (e.type === 'scroll' && e.target === document) {
      event.target = document.body.$$id;
      // page scroll container's top
      // safari is document.body.scrollTop
      // chrome is document.documentElement.scrollTop
      event.scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    }
    // CustomEvent detail
    if (e.detail) event.detail = e.detail;
    for (let i in e) {
      let v = e[i];
      if (
        typeof v !== 'object' &&
        typeof v !== 'function' &&
        i !== i.toUpperCase() &&
        !event.hasOwnProperty(i)
      ) {
        event[i] = v;
      }
    }

    if (TOUCH_EVENTS.indexOf(e.type) !== -1) {
      event.touches = serializeTouchList(e.touches);
      event.changedTouches = serializeTouchList(e.changedTouches);
    }

    worker.postMessage({
      type: 'event',
      event
    });

    if (e.type === 'touchstart') {
      touch = getTouch(e);
    } else if (e.type === 'touchend' && touch) {
      let t = getTouch(e);
      if (t) {
        let delta = Math.sqrt(
          Math.pow(t.pageX - touch.pageX, 2) +
          Math.pow(t.pageY - touch.pageY, 2)
        );
        if (delta < 10) {
          event.type = 'click';
          worker.postMessage({ type: 'event', event });
        }
      }
    }
  }

  var body = {
    type: 'div',
  };

  function generateVTree(vtree) {
    if (!vtree) return null;
    if (typeof vtree === 'string') return vtree;
    let { type, props, children } = vtree;
    return React.createElement(type, props, children.map(generateVTree));
  }
  let __update_vtree__ = () => {};
  class App extends React.Component{
    state = { vtree: null };
    componentWillMount() {
      __update_vtree__ = (vtree) => {
        this.setState({ vtree });
      }
    }
    render() {
      return React.createElement('div', {}, generateVTree(this.state.vtree));
    }
  }

  ReactDOM.render(React.createElement(App), document.querySelector('#mountNode'));

  function createTextNode(text) {
    return createElement('span', {}, [text ? String(text) : '']);
  }

  function createElement(type, props, children = []) {
    return { type, props, children };
  }

  const COMPONENT_MAP = {
    VIEW: 'div',
    BUTTON: ICEDesignBase.Button,
    'BUTTON-GROUP': ICEDesignBase.Button.Group,
    CHECKBOX: ICEDesignBase.Checkbox,
  }
  function getComponent(nodeName) {
    return COMPONENT_MAP[nodeName] || 'div';
  }
  function getProps(vnode) {
    const props = {};

    if (vnode.$$id) {
      props['data-target-id'] = vnode.$$id;
    }

    if (vnode.className) {
      props.className = vnode.className;
    }

    if (vnode.style) {
      props.style = {};
      setStyle(props, vnode.style);
    }

    if (vnode.attributes) {
      for (let i = 0; i < vnode.attributes.length; i++) {
        let a = vnode.attributes[i];
        props[a.name] = a.value;
      }
    }

    if (vnode.events) {
      for (let i = 0; i < vnode.events.length; i++) {
        addEvent(props, vnode.events[i]);
      }
    }
    return props;
  }

  function createNode(vnode) {
    let node;
    if (vnode.nodeType === 3) {
      node = createTextNode(vnode.data);
    } else if (vnode.nodeType === 1) {

      var children = [];
      if (vnode.childNodes) {
        for (let i = 0; i < vnode.childNodes.length; i++) {
          children[i] = createNode(vnode.childNodes[i])
        }
      }

      node = createElement(getComponent(vnode.nodeName), getProps(vnode), children);
    }

    setNode(vnode, node);
    return node;
  }
  // Returns "attributes" if it was an attribute mutation.
  // "characterData" if it was a mutation to a CharacterData node.
  // And "childList" if it was a mutation to the tree of nodes.
  const MUTATIONS = {
    childList({ target, removedNodes, addedNodes, nextSibling }) {
      let vnode = target;

      if (vnode && vnode.nodeName === 'BODY') {
        body.$$id = vnode.$$id;
      }

      let parent = getNode(vnode);
      if (removedNodes) {
        for (let i = removedNodes.length; i--;) {
          let node = getNode(removedNodes[i]);
          deleteNode(node);
          if (parent && node) {
            parent.children.splice(parent.children.indexOf(node), 1);
          }
        }
      }

      if (addedNodes) {
        for (let i = 0; i < addedNodes.length; i++) {
          let newNode = getNode(addedNodes[i]);
          if (!newNode) {
            newNode = createNode(addedNodes[i]);
          }

          if (parent) {
            if (parent.children) {
              parent.children.push(newNode);
            } else {
              parent.children = [newNode];
            }
            // parent.insertBefore(newNode, nextSibling && getNode(nextSibling) || null);
          }
        }

      }

      __update_vtree__(body);
    },
    attributes({ target, attributeName, newValue, style }) {
      let node = getNode(target);
      // Node maybe null when node is removed and there is a setInterval change the node that will cause error
      if (!node) return;

      // TODO: some with `createNode`, should processed by one method
      if (style) {
        setStyle(node.props, style);
      } else if (newValue == null) {
        node.removeAttribute(attributeName);
      } else if (typeof newValue === 'object' || typeof newValue === 'boolean') {
        node[attributeName] = newValue;
      } else {
        node.setAttribute(attributeName, newValue);
      }
    },
    characterData({ target, newValue }) {
      let node = getNode(target);
      node.children[0] = newValue;
      __update_vtree__(body);
    },
    addEvent({ target, eventName }) {
      let node = getNode(target);
      if (!node) return;

      addEvent(node, eventName);
    },
    removeEvent({ target, eventName }) {
      let node = getNode(target);
      if (!node) return;

      removeEvent(node, eventName);
    },
    canvasRenderingContext2D({ target, method, args, properties }) {
      let canvas = getNode(target);
      if (!canvas) return;

      let context = canvas.getContext('2d');

      if (properties) {
        for (let key in properties) {
          if (properties.hasOwnProperty(key)) {
            context[key] = properties[key];
          }
        }
      }

      if (method) {
        context[method].apply(context, args);
      }
    }
  };

  worker.onmessage = ({ data }) => {
    let type = data.type;
    if (type === 'MutationRecord') {
      let mutations = data.mutations;
      for (let i = 0; i < mutations.length; i++) {
        // apply mutation
        let mutation = mutations[i];
        MUTATIONS[mutation.type](mutation);
      }
    }
  };

  worker.postMessage({
    type: 'init',
    url: location.href,
    width: document.documentElement.clientWidth
  });
};
