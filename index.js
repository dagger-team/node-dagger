const path = require('path');

const fetch = require('node-fetch');

function _isPromise(obj) {
    return obj && obj.then && typeof obj.then === 'function';
}

const monkeypatchLambdaHandler = (api) => {
    const Runtime = require.cache['/var/runtime/Runtime.js'].exports;
    const previous_handleOnce = Runtime.prototype.handleOnce;
    const new_handleOnce = function() {
        const previous_handler = this.handler;
        const new_handler = async function(event, context, callback) {
            let return_value;

            const name = context.functionName;
            const id = context.awsRequestId;
            const metadata = {
                function_version: context.functionVersion,
                function_name: context.functionName,
                memoryLimitInMB: context.memoryLimitInMB,
                logGroupName: context.logGroupName,
                logStreamName: context.logStreamName,
                invokedFunctionArn: context.invokedFunctionArn,
                awsRequestId: context.awsRequestId
            };
            const input = event;

            await api.sendTaskStatus('started', name, id, input, {}, metadata);

            try {
                return_value = previous_handler.apply(this, arguments);

                if(_isPromise(return_value)) {
                    return_value = await return_value;
                }

                if(typeof return_value !== 'object') {
                    return_value = {return_value};
                }

                await api.sendTaskStatus('succeeded', name, id, input, return_value, metadata);
            } catch(error) {
                const error_object = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                };
                await api.sendTaskStatus('failed', name, id, input, error_object, metadata);

                throw error;
            }

            return return_value;
        };
        this.handler = new_handler;

        return previous_handleOnce.apply(this, arguments);
    };
    Runtime.prototype.handleOnce = new_handleOnce;
};

// Lambda Runtime uses setImmediete, so we use nextTick, which runs before that

class DaggerAPI {
    constructor(api_token) {
        this.api_token = api_token;
    }

    async sendTaskStatus(status, task_name, id, input, output, metadata) {
        const body = {
            status,
            task_name,
            id,
            input,
            output,
            metadata,
            api_token: this.api_token
        };
    
        await fetch('https://api.getdagger.com/v1/tasks/status', {
            method: 'post',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        });
    };
};

module.exports = (api_token) => {
    const api = new DaggerAPI(api_token)

    if(process.env._HANDLER) {
        console.log('Dagger initializing on Lambda');

        process.nextTick(() => {
            try {
                monkeypatchLambdaHandler(api);
            } catch(error) {
                console.log(error);
            }
        });
    }

    return api;
};
