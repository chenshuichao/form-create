import {creatorFactory} from '@form-create/core';

const DEFAULT_FORMATS = {
    date: 'yyyy-MM-dd',
    month: 'yyyy-MM',
    datetime: 'yyyy-MM-dd HH:mm:ss',
    week: 'yyyywWW',
    timerange: 'HH:mm:ss',
    daterange: 'yyyy-MM-dd',
    monthrange: 'yyyy-MM',
    datetimerange: 'yyyy-MM-dd HH:mm:ss',
    year: 'yyyy'
};

const name = 'datePicker';

export default {
    name,
    maker: (function () {
        return ['year', 'month', 'date', 'dates', 'week', 'datetime', 'datetimerange', 'daterange'].reduce((initial, type) => {
            initial[type] = creatorFactory(name, {type});
            return initial
        }, {});
    }()),
    mergeProp(ctx) {
        const props = ctx.prop.props;
        if (!props.valueFormat) {
            props.valueFormat = DEFAULT_FORMATS[props.type] || DEFAULT_FORMATS['date'];
        }
    }
}
