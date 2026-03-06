/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as _ from 'lodash';
import config from '../../../config'

abstract class BaseService {
    protected collectionName = null;
    protected constants;

    constructor() {
        this.constants = {
            expiration: 60,
        };
    }

    protected handleError(error: any) {
        let errorMessage = 'UNKNOWN_ERROR';
        if (error.data && (error.data.MESSAGE || error.data.message)) {
            errorMessage = error.data.MESSAGE ? error.data.MESSAGE : error.data.message;
        } else if (error.status) {
            if (error.status === -1) {
                errorMessage = 'SERVER_NOT_FOUND';
                // Don't redirect here or you will create a loop
            } else if ((error.data && error.data.startsWith('401')) || error.status === 401) {
                errorMessage = 'UNAUTHORIZED';
            } else if ((error.data && error.data.startsWith('404')) || error.status === 404) {
                errorMessage = 'PAGE_NOT_FOUND';
            } else if (error.status === 500) {
                errorMessage = 'INTERNAL_SERVER_ERROR';
            }
        }
        console.error(errorMessage)
    }

    protected getCollectionUrl(licenseId: number) {
        if (this.collectionName === null) throw new Error('collectionName must be set in child class');
        return this.getApiUrl() + '/' + licenseId + '/' + this.collectionName;
    }
    protected getElementUrl(licenseId: number, id: string) {
        return this.getCollectionUrl(licenseId) + '/' + id;
    }

    public getLockerApiUrl() {
        return config['cloudInterface']['locker'];
    }
    public getRFIDApiUrl() {
        return config['cloudInterface']['rfid'];
    }
    public getApiUrl() {
        return config['nuage']['serverUrl'];
    }

    public getConstants() {
        return this.constants;
    }

    public destroyStorage() {
        this.destroyFromStorage('authorization');
        this.destroyFromStorage('user');
        this.destroyFromStorage('expiration');
        this.destroyFromStorage('receipt');
    }

    public setToStorage(key: string, value: string) {
        return sessionStorage.setItem(key, value);
    }

    public getFromStorage(key: string) {
        return sessionStorage.getItem(key);
    }

    public destroyFromStorage(key: string) {
        // $http.get(settings.remote_api.shortcut + '/logout');
        sessionStorage.removeItem(key);
        return localStorage.removeItem(key);
    }

    public setToLocalStorage(key: string, value: string) {
        return localStorage.setItem(key, value);
    }

    public getFromLocalStorageObj(key: string, _defaultValue = '{}') {
        const value = localStorage.getItem(key);
        if (value) {
            return JSON.parse(value);
        } else {
            return false;
        }
    }
    public setToLocalStorageObj(key: string, value: any) {
        return localStorage.setItem(key, JSON.stringify(value));
    }

    public getFromLocalStorage(key: string) {
        return localStorage.getItem(key);
    }
    public destroyFromLocalStorage(key: string) {
        // $http.get(settings.remote_api.shortcut + '/logout');
        return localStorage.removeItem(key);
    }

    public hasStorage() {
        return 'sessionStorage' in window && window.sessionStorage;
    }
    public getFontSize(value: string | number) {
        const size = <any>{
            value,
            element: +value + 14,
        };

        size.value += 'px';
        size.element += 'px';
        return size;
    }
}

export default BaseService;
