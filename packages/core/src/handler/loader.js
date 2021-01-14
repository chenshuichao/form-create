import extend from '@form-create/utils/lib/extend';
import debounce from '@form-create/utils/lib/debounce';
import {byCtx, copyRule, enumerable, getRule, invoke} from '../frame/util';
import is, {hasProperty} from '@form-create/utils/lib/type';
import {err} from '@form-create/utils/lib/console';
import {baseRule} from '../factory/creator';
import {$set} from '@form-create/utils/lib';
import RuleContext from '../factory/context';

export default function useLoader(Handler) {
    extend(Handler.prototype, {
        nextLoad() {
            const id = this.loadedId;
            this.vm.$nextTick(() => {
                id === this.loadedId && this.refresh();
            });
        },
        parseRule(_rule) {
            const rule = getRule(_rule);

            Object.defineProperties(rule, {
                __origin__: enumerable(_rule, true)
            });

            fullRule(rule);

            if (rule.field && hasProperty(this.options.formData || {}, rule.field))
                rule.value = this.options.formData[rule.field];

            rule.options = parseArray(rule.options);

            this.ruleEffect(rule, 'init');

            ['on', 'props', 'nativeOn'].forEach(k => {
                this.parseInjectEvent(rule, rule[k] || {});
            })

            return rule;
        },
        isRepeatRule(rule) {
            return this.repeatRule.indexOf(rule) > -1;
        },
        loadRule() {
            // console.warn('%c load', 'color:blue');
            this.cycleLoad = false;
            if (this.pageEnd) {
                this.bus.$emit('load-start');
            }
            this._loadRule(this.rules);
            if (this.cycleLoad && this.pageEnd) {
                return this.loadRule();
            }
            if (this.pageEnd) {
                this.bus.$emit('load-end');
            }
            this.vm._renderRule();
            this.$render.initOrgChildren();
            this.syncForm();
        },
        loadChildren(children, parent) {
            this.cycleLoad = false;
            this.bus.$emit('load-start');
            this._loadRule(children, parent);
            if (this.cycleLoad) {
                return this.loadRule();
            }
            this.$render.clearCache(parent);
        },
        _loadRule(rules, parent) {

            const preIndex = (i) => {
                let pre = rules[i - 1];
                if (!pre || !pre.__fc__) {
                    return i > 0 ? preIndex(i - 1) : -1;
                }
                let index = this.sort.indexOf(pre.__fc__.id);
                return index > -1 ? index : preIndex(i - 1);
            }

            const loadChildren = (children, parent) => {
                if (is.trueArray(children)) {
                    this._loadRule(children, parent);
                }
            };

            this.loading = true;
            rules.map((_rule, index) => {
                if (parent && is.String(_rule)) return;
                if (!this.pageEnd && !parent && index >= this.first) return;

                if (!is.Object(_rule) || !getRule(_rule).type)
                    return err('未定义生成规则的 type 字段', _rule);

                if (_rule.__fc__ && _rule.__fc__.root === rules && this.ctxs[_rule.__fc__.id]) {
                    loadChildren(_rule.__fc__.rule.children, _rule.__fc__);
                    return _rule.__fc__;
                }

                let rule = getRule(_rule);

                if (rule.field && this.fieldCtx[rule.field] && this.fieldCtx[rule.field] !== _rule.__fc__) {
                    this.repeatRule.push(_rule);
                    return err(`${rule.field} 字段已存在`, _rule);
                }

                let ctx;
                if (_rule.__fc__) {
                    ctx = _rule.__fc__;
                    const check = !ctx.check(this);
                    if (ctx.deleted) {
                        if (check) {
                            if (isCtrl(ctx)) {
                                return;
                            }
                            ctx.update(this);
                        }
                    } else {
                        if (check) {
                            if (isCtrl(ctx)) {
                                return;
                            }
                            rules[index] = _rule = _rule._clone ? _rule._clone() : copyRule(_rule);
                            ctx = null;
                        }
                    }
                }
                if (!ctx) {
                    ctx = new RuleContext(this, this.parseRule(_rule));
                    this.bindParser(ctx);
                } else if (ctx.originType !== ctx.rule.type) {
                    ctx.updateType();
                    this.bindParser(ctx);
                }
                this.appendValue(ctx.rule);
                [false, true].forEach(b => this.parseEmit(ctx, b));
                ctx.parent = parent || null;
                ctx.root = rules;
                this.setCtx(ctx);

                loadChildren(ctx.rule.children, ctx);

                if (!parent) {
                    const _preIndex = preIndex(index);
                    if (_preIndex > -1) {
                        this.sort.splice(_preIndex + 1, 0, ctx.id);
                    } else {
                        this.sort.push(ctx.id);
                    }
                }

                const r = ctx.rule;
                if (!ctx.updated) {
                    ctx.updated = true;
                    if (is.Function(r.update)) {
                        this.bus.$once('load-end', () => {
                            this.refreshUpdate(ctx, r.value);
                        });
                    }
                    this.effect(ctx, 'loaded');
                }

                if (ctx.input)
                    Object.defineProperty(r, 'value', this.valueHandle(ctx));
                if (this.refreshControl(ctx)) this.cycleLoad = true;
                return ctx;
            });
            this.loading = false;
        },
        refreshControl(ctx) {
            return ctx.input && ctx.rule.control && this.useCtrl(ctx);
        },
        useCtrl(ctx) {
            const controls = getCtrl(ctx), validate = [], api = this.api;
            if (!controls.length) return false;

            for (let i = 0; i < controls.length; i++) {
                const control = controls[i], handleFn = control.handle || (val => val === control.value);
                const data = {
                    ...control,
                    valid: invoke(() => handleFn(ctx.rule.value, api)),
                    ctrl: findCtrl(ctx, control.rule),
                };
                if ((data.valid && data.ctrl) || (!data.valid && !data.ctrl)) continue;
                validate.push(data);
            }
            if (!validate.length) return false;

            let flag = false;
            validate.reverse().forEach(({valid, rule, prepend, append, child, ctrl}) => {
                if (valid) {
                    flag = true;
                    const ruleCon = {
                        type: 'fcFragment',
                        native: true,
                        __ctrl: true,
                        children: rule,
                    }
                    ctx.ctrlRule.push(ruleCon);
                    this.bus.$once('load-start', () => {
                        // this.cycleLoad = true;
                        if (prepend) {
                            api.prepend(ruleCon, prepend, child)
                        } else if (append || child) {
                            api.append(ruleCon, append || ctx.id, child)
                        } else {
                            ctx.root.splice(ctx.root.indexOf(ctx.origin) + 1, 0, ruleCon);
                        }
                    });
                } else {
                    ctx.ctrlRule.splice(ctx.ctrlRule.indexOf(ctrl), 1);
                    const ctrlCtx = byCtx(ctrl);
                    ctrlCtx && ctrlCtx.rm();
                }
            });
            this.vm.$emit('control', ctx.origin, this.api);
            this.effect(ctx, 'control');
            return flag;
        },
        reloadRule: debounce(function (rules) {
            return this._reloadRule(rules);
        }, 1),
        _reloadRule(rules) {
            // console.warn('%c reload', 'color:red');
            if (!rules) rules = this.rules;

            const ctxs = {...this.ctxs};

            this.clearNextTick();
            this.$render.clearOrgChildren();
            this.initData(rules);

            this.bus.$once('load-end', () => {
                Object.keys(ctxs).filter(id => this.ctxs[id] === undefined)
                    .forEach(id => this.rmCtx(ctxs[id], true));
                this.$render.clearCacheAll();
            });

            this.loadRule();
            this.refresh();

            this.bus.$off('next-tick', this.nextReload);
            this.bus.$once('next-tick', this.nextReload);
        },
        //todo 组件生成全部通过 alias
        refresh() {
            this.vm._refresh();
        },
    });
}


function parseArray(validate) {
    return Array.isArray(validate) ? validate : [];
}

function fullRule(rule) {
    const def = baseRule();

    Object.keys(def).forEach(k => {
        if (!hasProperty(rule, k)) rule[k] = def[k];
    });
    return rule;
}

function getCtrl(ctx) {
    const control = ctx.rule.control || [];
    if (is.Object(control)) return [control];
    else return control;
}

function findCtrl(ctx, rule) {
    for (let i = 0; i < ctx.ctrlRule.length; i++) {
        const ctrl = ctx.ctrlRule[i];
        if (ctrl.children === rule)
            return ctrl;
    }
}

function isCtrl(ctx) {
    return !!ctx.rule.__ctrl;
}
