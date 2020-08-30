import axios from "axios";
import crypto from "crypto";
import chalk from "chalk";

const BASE_URL = "https://api.binance.com/api/v3";
const API_KEY = "UFXm47ecR6IaD2hMlFDclbNxQF9dVPVnssYFAm99VUtoPI65EYgAaOai4nuEwHSC";
const API_SECRET = "6rVeGsEWErt0Vbfb8DeMYn9xwPOnNfa8zdshB49lMfq4tnnfnq2KXOfDwpGxDlb5";

export async function asyncForEach(array: any[], callback: Function) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

export function mergeObjectsInUnique(array: any[], property: string) {
    const newArray = new Map();

    array.forEach((item) => {
        const propertyValue = item[property];
        newArray.has(propertyValue)
            ? newArray.set(propertyValue, { ...item, ...newArray.get(propertyValue) })
            : newArray.set(propertyValue, item);
    });

    return Array.from(newArray.values());
}

export function timeout(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function countDecimals(value: number) {
    if (Math.floor(value) === value) return 0;
    return value.toString().split(".")[1].length || 0;
}

export async function getRequest(route: string, params: string, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const { data } = await axios.get(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return data;
    } catch (err) {
        const errMsg = err.response ? err.response.data.msg : err;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
}

export async function postRequest(route: string, params: string, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const response = await axios.post(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, null, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return response;
    } catch (err) {
        const errMsg = err.response.data.msg;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
}

export async function deleteRequest(route: string, params: string, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const response = await axios.delete(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return response;
    } catch (err) {
        const errMsg = err.response.data.msg;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
}
